/**
 * Socket.IO sobre el servidor HTTP de Fastify, con postgres-adapter para varias réplicas.
 * La API solo emite lo efímero (presencia y "escribiendo"); el resto lo publica el worker desde el outbox.
 *
 * Cliente: ante `disconnect` con motivo `io server disconnect` (sesión vencida o cambio de acceso) debe
 * refrescar la sesión y llamar a `connect()`; las salas se vuelven a pedir en cada conexión.
 */
import type { Server as ServidorHttp, IncomingMessage } from 'node:http';
import fastifyCookie from '@fastify/cookie';
import { createAdapter } from '@socket.io/postgres-adapter';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { esStaff, puedeEscribirTicket, puedeVerTicket, type UsuarioSesion } from '@eco/shared/dominio';
import {
  ERROR_SOCKET_NO_AUTENTICADO,
  SALAS,
  SOCKET_PATH,
  type EventosCliente,
  type EventosServidor,
  type UsuarioPresente,
} from '@eco/shared/realtime';
import { COOKIE_SESION, verificarSesion } from '../auth/sesion';
import type { Config } from '../config';
import { accesoTicket, leerConfiguracion, obtenerUsuarioSesion } from '../db';
import type { Deps } from '../deps';
import { crearLog } from '../log';
import { crearLimite } from './limite';
import { asegurarTablaAdjuntos, crearPoolAdapter } from './pool';

/** Mensaje entre servidores (lo envía el worker): volver a comprobar el acceso a las salas. */
export const EVENTO_REEVALUAR = 'eco:reevaluar';
/** Error del handshake que no es de autenticación (p. ej. base caída): el cliente puede reintentar. */
export const ERROR_SOCKET_INTERNO = 'interno';

interface EventosEntreServidores {
  [EVENTO_REEVALUAR]: () => void;
}
interface DatosSocket {
  /** Viaja a las demás réplicas con `fetchSockets`: solo lo necesario para la presencia. */
  usuario: UsuarioPresente;
  id: string;
  expira: number;
}
type ServidorEco = Server<EventosCliente, EventosServidor, EventosEntreServidores, DatosSocket>;
type SocketEco = Socket<EventosCliente, EventosServidor, EventosEntreServidores, DatosSocket>;

export interface OpcionesRealtime {
  /** Cada cuánto se recalcula la presencia (cubre réplicas que cayeron sin avisar). */
  repasoPresenciaMs?: number;
  /** Opciones del latido entre réplicas. */
  latidoClusterMs?: number;
}

const RE_SALA_TICKET = /^ticket:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const MAX_SALAS = 60;

const zSala = z.object({ sala: z.string().max(60) });
const zEscribiendo = z.object({
  ticketId: z.uuid(),
  escribiendo: z.boolean(),
  interno: z.boolean().optional(),
});

/**
 * El Origin debe ser el de APP_URL. Sin cabecera se acepta (peticiones GET del mismo origen y clientes
 * que no son navegadores: igual necesitan la cookie). Fuera de producción, localhost y 127.0.0.1 equivalen.
 */
export function origenPermitido(origen: string | undefined, config: Pick<Config, 'appUrl' | 'produccion'>): boolean {
  if (origen === undefined) return true;
  try {
    const pedido = new URL(origen);
    const propio = new URL(config.appUrl);
    if (pedido.origin === propio.origin) return true;
    const local = (h: string) => h === 'localhost' || h === '127.0.0.1';
    return (
      !config.produccion &&
      pedido.protocol === propio.protocol &&
      pedido.port === propio.port &&
      local(pedido.hostname) &&
      local(propio.hostname)
    );
  } catch {
    return false;
  }
}

export async function iniciarRealtime(servidor: ServidorHttp, deps: Deps, opciones: OpcionesRealtime = {}) {
  const { config, conexion } = deps;
  const { db } = conexion;
  const log = crearLog('realtime', config.LOG_LEVEL);
  const alFallar = (err: Error) => log.warn({ err: { message: err.message } }, 'Error en el canal entre réplicas');

  const pool = crearPoolAdapter(config.DATABASE_URL, alFallar);
  await asegurarTablaAdjuntos(pool);

  const io: ServidorEco = new Server(servidor, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: 16_384,
    allowRequest: (req: IncomingMessage, decidir) =>
      decidir(null, origenPermitido(req.headers.origin, config)),
  });
  io.adapter(
    createAdapter(pool, {
      errorHandler: alFallar,
      ...(opciones.latidoClusterMs
        ? { heartbeatInterval: opciones.latidoClusterMs, heartbeatTimeout: opciones.latidoClusterMs * 3 }
        : {}),
    }),
  );

  let cerrando = false;
  /** Cola por socket: unirse, salir y reevaluar nunca se solapan. */
  const colas = new WeakMap<SocketEco, Promise<unknown>>();
  const encolar = (socket: SocketEco, tarea: () => Promise<void>) => {
    const siguiente = (colas.get(socket) ?? Promise.resolve())
      .then(tarea)
      .catch((err: Error) => log.error({ err: { message: err.message } }, 'Error al atender un socket'));
    colas.set(socket, siguiente);
    return siguiente;
  };

  // -------------------------------------------------------------------------------------------
  // Presencia
  // -------------------------------------------------------------------------------------------

  /** Por ticket: si hay un cálculo en curso y si quedó desactualizado mientras tanto. */
  const calculando = new Map<string, { sucio: boolean }>();
  const ultimaPresencia = new Map<string, string>();

  async function presentes(ticketId: string, excluir?: ReadonlySet<string>): Promise<UsuarioPresente[]> {
    const sala = io.in(SALAS.ticket(ticketId));
    // Si una réplica acaba de caer, el primer intento puede vencer esperando su respuesta.
    const sockets = await sala.fetchSockets().catch(() => sala.fetchSockets());
    const unicos = new Map<string, UsuarioPresente>();
    for (const s of sockets) {
      const u = s.data.usuario;
      if (u && !excluir?.has(s.id)) unicos.set(u.id, { id: u.id, nombre: u.nombre });
    }
    return [...unicos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id));
  }

  /** `soloCambios`: repaso periódico, no reenvía una lista igual a la última difundida por esta réplica. */
  async function difundirPresencia(ticketId: string, soloCambios = false): Promise<void> {
    if (cerrando) return;
    const enCurso = calculando.get(ticketId);
    if (enCurso) {
      enCurso.sucio ||= !soloCambios;
      return;
    }
    const estado = { sucio: false };
    calculando.set(ticketId, estado);
    try {
      do {
        estado.sucio = false;
        const usuarios = await presentes(ticketId);
        if (cerrando) return;
        const firma = usuarios.map((u) => u.id).join();
        if (!soloCambios || ultimaPresencia.get(ticketId) !== firma)
          io.to(SALAS.ticket(ticketId)).emit('presencia', { ticketId, usuarios });
        ultimaPresencia.set(ticketId, firma);
        soloCambios = false;
      } while (estado.sucio);
    } catch (err) {
      log.warn({ err: { message: (err as Error).message } }, 'No se pudo calcular la presencia');
    } finally {
      calculando.delete(ticketId);
    }
  }

  const ticketsDe = (salas: Iterable<string>) =>
    [...salas].flatMap((s) => RE_SALA_TICKET.exec(s)?.[1] ?? []);

  const ticketsLocales = () => ticketsDe(io.of('/').adapter.rooms.keys());

  const repaso = setInterval(() => {
    const locales = new Set(ticketsLocales());
    for (const id of ultimaPresencia.keys()) if (!locales.has(id)) ultimaPresencia.delete(id);
    for (const id of locales) void difundirPresencia(id, true);
  }, opciones.repasoPresenciaMs ?? 30_000);
  repaso.unref();

  // -------------------------------------------------------------------------------------------
  // Salas
  // -------------------------------------------------------------------------------------------

  /** Estado que no sale de esta réplica. */
  interface Local {
    /** Tickets en cuya sala está, con lo necesario para saber si puede escribir. */
    tickets: Map<string, { puedeEscribir: boolean; staff: boolean }>;
    /** `ticketId|interno` de los "escribiendo" sin apagar. */
    escribiendo: Set<string>;
  }
  const locales = new WeakMap<SocketEco, Local>();

  function avisarEscribiendo(socket: SocketEco, ticketId: string, escribiendo: boolean, interno: boolean) {
    const { id, nombre } = socket.data.usuario;
    const sala = interno ? SALAS.ticketInterno(ticketId) : SALAS.ticket(ticketId);
    socket.to(sala).emit('escribiendo', { ticketId, usuario: { id, nombre }, escribiendo, interno });
  }

  function apagarEscribiendo(socket: SocketEco, ticketId?: string) {
    const local = locales.get(socket);
    if (!local) return;
    for (const clave of local.escribiendo) {
      const [id, interno] = clave.split('|') as [string, string];
      if (ticketId && id !== ticketId) continue;
      local.escribiendo.delete(clave);
      avisarEscribiendo(socket, id, false, interno === 'true');
    }
  }

  async function salirDeTicket(socket: SocketEco, ticketId: string) {
    apagarEscribiendo(socket, ticketId);
    locales.get(socket)?.tickets.delete(ticketId);
    await socket.leave(SALAS.ticket(ticketId));
    await socket.leave(SALAS.ticketInterno(ticketId));
    void difundirPresencia(ticketId);
  }

  async function unirse(socket: SocketEco, sala: string): Promise<boolean> {
    const ticketId = RE_SALA_TICKET.exec(sala)?.[1];
    if (!ticketId && sala !== SALAS.tecnicos && sala !== SALAS.tablero) return false;
    // Rol y área actuales, no los del token.
    const u = await obtenerUsuarioSesion(db, socket.data.id);
    if (!u) {
      socket.disconnect(true);
      return false;
    }
    if (!socket.rooms.has(sala) && socket.rooms.size >= MAX_SALAS) return false;
    if (!ticketId) {
      if (!esStaff(u) || !socket.connected) return false;
      await socket.join(sala);
      return true;
    }
    const [acceso, { solicitanteVeArea }] = await Promise.all([accesoTicket(db, ticketId), leerConfiguracion(db)]);
    if (!acceso || !puedeVerTicket(u, acceso, { solicitanteVeArea }) || !socket.connected) return false;
    await socket.join(esStaff(u) ? [sala, SALAS.ticketInterno(ticketId)] : sala);
    locales.get(socket)?.tickets.set(ticketId, { puedeEscribir: puedeEscribirTicket(u, acceso), staff: esStaff(u) });
    return true;
  }

  /** Cambió la configuración de visibilidad: sacar a quien ya no puede estar en una sala. */
  async function reevaluar(socket: SocketEco): Promise<void> {
    if (!socket.connected) return;
    const u: UsuarioSesion | null = await obtenerUsuarioSesion(db, socket.data.id);
    if (!u) {
      socket.disconnect(true);
      return;
    }
    if (!esStaff(u)) {
      await socket.leave(SALAS.tecnicos);
      await socket.leave(SALAS.tablero);
    }
    const { solicitanteVeArea } = await leerConfiguracion(db);
    for (const ticketId of ticketsDe(socket.rooms)) {
      const acceso = await accesoTicket(db, ticketId);
      if (!acceso || !puedeVerTicket(u, acceso, { solicitanteVeArea })) await salirDeTicket(socket, ticketId);
      else if (!esStaff(u)) await socket.leave(SALAS.ticketInterno(ticketId));
    }
  }

  io.on(EVENTO_REEVALUAR, () => {
    for (const socket of io.of('/').sockets.values()) void encolar(socket, () => reevaluar(socket));
  });

  // -------------------------------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------------------------------

  io.use(async (socket, next) => {
    try {
      const token = fastifyCookie.parse(socket.handshake.headers.cookie ?? '')[COOKIE_SESION];
      const sesion = token ? await verificarSesion(token, config.SESSION_SECRET) : null;
      const u = sesion ? await obtenerUsuarioSesion(db, sesion.id) : null;
      // `handshake` se copia a las otras réplicas (y a la tabla de adjuntos): sin credenciales.
      delete socket.handshake.headers.cookie;
      delete socket.handshake.headers.authorization;
      socket.handshake.auth = {};
      if (!sesion || !u) return next(new Error(ERROR_SOCKET_NO_AUTENTICADO));
      socket.data.id = u.id;
      socket.data.usuario = { id: u.id, nombre: u.nombre };
      socket.data.expira = sesion.expira;
      next();
    } catch (err) {
      log.error({ err: { message: (err as Error).message } }, 'No se pudo autenticar el socket');
      next(new Error(ERROR_SOCKET_INTERNO));
    }
  });

  io.on('connection', (socket) => {
    const local: Local = { tickets: new Map(), escribiendo: new Set() };
    locales.set(socket, local);
    void socket.join([SALAS.todos, SALAS.usuario(socket.data.id)]);

    const vencimiento = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expira * 1000 - Date.now()),
    );

    const limiteSalas = crearLimite(60, 10_000);
    const limiteEscribiendo = crearLimite(30, 10_000);
    const limiteTotal = crearLimite(200, 10_000);
    // Un cliente que inunda el servidor se desconecta.
    socket.use((_paquete, next) => {
      if (limiteTotal()) next();
      else socket.disconnect(true);
    });

    socket.on('sala:unirse', (datos: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const responder = ack as (r: { ok: boolean }) => void;
      const p = zSala.safeParse(datos);
      if (!p.success || !limiteSalas()) return responder({ ok: false });
      void encolar(socket, async () => {
        let ok = false;
        try {
          ok = await unirse(socket, p.data.sala);
        } finally {
          responder({ ok });
        }
        const ticketId = ok ? RE_SALA_TICKET.exec(p.data.sala)?.[1] : undefined;
        if (ticketId) void difundirPresencia(ticketId);
      });
    });

    socket.on('sala:salir', (datos: unknown) => {
      const p = zSala.safeParse(datos);
      if (!p.success || !limiteSalas()) return;
      void encolar(socket, async () => {
        const { sala } = p.data;
        const ticketId = RE_SALA_TICKET.exec(sala)?.[1];
        if (ticketId) {
          if (socket.rooms.has(sala)) await salirDeTicket(socket, ticketId);
        } else if (sala === SALAS.tecnicos || sala === SALAS.tablero) await socket.leave(sala);
      });
    });

    socket.on('escribiendo', (datos: unknown) => {
      const p = zEscribiendo.safeParse(datos);
      if (!p.success) return;
      const { ticketId, escribiendo, interno = false } = p.data;
      // Apagar el indicador nunca se limita.
      if (escribiendo && !limiteEscribiendo()) return;
      void encolar(socket, async () => {
        const permiso = local.tickets.get(ticketId);
        if (!permiso?.puedeEscribir || (interno && !permiso.staff)) return;
        const clave = `${ticketId}|${interno}`;
        if (escribiendo) local.escribiendo.add(clave);
        else if (!local.escribiendo.delete(clave)) return;
        avisarEscribiendo(socket, ticketId, escribiendo, interno);
      });
    });

    let salas: string[] = [];
    socket.on('disconnecting', () => {
      salas = ticketsDe(socket.rooms);
      apagarEscribiendo(socket);
    });
    socket.on('disconnect', () => {
      clearTimeout(vencimiento);
      for (const id of salas) void difundirPresencia(id);
    });
  });

  return {
    io,
    /** Desconecta a los clientes de esta réplica (reconectan solos) sin cerrar el servidor HTTP. */
    cerrar: async () => {
      if (cerrando) return;
      cerrando = true;
      clearInterval(repaso);
      // Las demás réplicas quedan con la presencia sin los usuarios de esta.
      const propios = new Set(io.of('/').sockets.keys());
      await Promise.allSettled(
        ticketsLocales().map(async (ticketId) => {
          const usuarios = await presentes(ticketId, propios);
          io.except([...propios])
            .to(SALAS.ticket(ticketId))
            .emit('presencia', { ticketId, usuarios });
        }),
      );
      io.engine.close();
      await io.of('/').adapter.close();
      // Margen para que salgan los últimos avisos al resto del cluster.
      await new Promise((r) => setTimeout(r, 100));
      await Promise.race([pool.end(), new Promise((r) => setTimeout(r, 2000).unref())]).catch(() => {});
    },
  };
}
export type Realtime = Awaited<ReturnType<typeof iniciarRealtime>>;
