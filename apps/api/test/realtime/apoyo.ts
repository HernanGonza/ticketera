/** Servidor Socket.IO propio y clientes reales para las pruebas (sin las rutas del backend). */
// Quien importe este archivo necesita cargar los tipos de Fastify y de las cookies que usan `deps.ts` y `guardas.ts`.
import type {} from 'fastify';
import type {} from '@fastify/cookie';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { SOCKET_PATH, type EventosCliente, type EventosServidor } from '@eco/shared/realtime';
import { COOKIE_SESION } from '../../src/auth/sesion';
import { cargarConfig } from '../../src/config';
import { iniciarRealtime, type OpcionesRealtime } from '../../src/realtime';
import type { Entorno } from '../db/base';
import { tokenDePrueba } from './sesion';

export const APP_URL = 'http://eco.prueba';

export const configPrueba = (url: string, extra: Record<string, string> = {}) =>
  cargarConfig({ NODE_ENV: 'test', DATABASE_URL: url, APP_URL, LOG_LEVEL: process.env.LOG_PRUEBA ?? 'silent', ...extra });

export async function crearServidor(entorno: Entorno, opciones: OpcionesRealtime = {}) {
  const config = configPrueba(entorno.url);
  const http = createServer();
  const rt = await iniciarRealtime(http, { config, conexion: entorno }, opciones);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const clientes: Cliente[] = [];

  return {
    config,
    rt,
    url,
    /** Conecta un cliente autenticado como `usuario`. */
    async conectar(usuario: UsuarioSesion, duracionSeg?: number) {
      const token = await tokenDePrueba(entorno.db, usuario, config.SESSION_SECRET, duracionSeg);
      const c = crearCliente(url, { cookie: `${COOKIE_SESION}=${token}`, origin: APP_URL });
      clientes.push(c);
      await c.conectado;
      return c;
    },
    async cerrar() {
      for (const c of clientes) c.socket.close();
      await rt.cerrar();
      await new Promise((ok) => http.close(ok));
    },
  };
}
export type Servidor = Awaited<ReturnType<typeof crearServidor>>;

type Nombre = keyof EventosServidor;
export type Payload<E extends Nombre> = Parameters<EventosServidor[E]>[0];
export interface Recibido {
  evento: Nombre;
  payload: unknown;
  /** `performance.now()` al llegar. */
  en: number;
}

export function crearCliente(url: string, cabeceras: Record<string, string>) {
  const socket: Socket<EventosServidor, EventosCliente> = io(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    extraHeaders: cabeceras,
    reconnection: false,
    forceNew: true,
  });
  const recibidos: Recibido[] = [];
  const avisos = new Set<() => void>();
  socket.onAny((evento: Nombre, payload: unknown) => {
    recibidos.push({ evento, payload, en: performance.now() });
    for (const a of avisos) a();
  });
  const conectado = new Promise<void>((ok, mal) => {
    socket.once('connect', () => ok());
    socket.once('connect_error', (e) => mal(e));
  });
  conectado.catch(() => {});

  const de = <E extends Nombre>(evento: E) =>
    recibidos.filter((r) => r.evento === evento).map((r) => r.payload as Payload<E>);

  return {
    socket,
    conectado,
    recibidos,
    de,
    limpiar: () => void recibidos.splice(0),
    /** Primer evento (ya recibido o futuro) que cumple la condición. */
    esperar<E extends Nombre>(
      evento: E,
      cumple: (p: Payload<E>) => boolean = () => true,
      ms = 8000,
    ): Promise<Payload<E>> {
      return new Promise((ok, mal) => {
        const mirar = () => {
          const p = de(evento).find(cumple);
          if (p === undefined) return;
          clearTimeout(limite);
          avisos.delete(mirar);
          ok(p);
        };
        const limite = setTimeout(() => {
          avisos.delete(mirar);
          mal(new Error(`No llegó ${evento}. Recibidos: ${recibidos.map((r) => r.evento).join(', ') || 'nada'}`));
        }, ms);
        avisos.add(mirar);
        mirar();
      });
    },
    unirse: (sala: string) =>
      new Promise<boolean>((ok) => socket.emit('sala:unirse', { sala }, (r) => ok(r.ok))),
    desconectado: () =>
      new Promise<string>((ok) => {
        if (socket.disconnected) ok('ya');
        else socket.once('disconnect', (motivo) => ok(motivo));
      }),
  };
}
export type Cliente = ReturnType<typeof crearCliente>;

export const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Repite la comprobación hasta que dé verdadero (sirve también en `beforeAll`). */
export async function hasta(comprobar: () => unknown, ms = 8000): Promise<void> {
  const limite = Date.now() + ms;
  while (!(await comprobar())) {
    if (Date.now() > limite) throw new Error(`No se cumplió en ${ms} ms: ${comprobar}`);
    await pausa(25);
  }
}
