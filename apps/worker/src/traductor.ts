/**
 * Traduce cada evento de dominio del outbox a eventos de Socket.IO, trabajos de cola y notificaciones.
 * Todo se escribe en la transacción que marca el evento como publicado: se aplica una sola vez.
 *
 * Reglas de privacidad: lo interno (notas y sus adjuntos) solo viaja a `ticket:{id}:interno` y solo
 * genera avisos para staff. No se avisa a quien originó la acción.
 */
import {
  crearNotificaciones,
  extracto,
  obtenerAdjunto,
  obtenerMensaje,
  obtenerTicketResumen,
  type OutboxFila,
  type Tx,
} from '@eco/api/db';
import {
  esStaff,
  ETIQUETA_ESTADO,
  type TipoNotificacion,
} from '@eco/shared/dominio';
import { AGRUPADO_MENSAJES_SEG } from '@eco/shared/colas';
import type { CambiosTicket, EventosDominio, TipoEventoDominio } from '@eco/shared/eventos';
import { SALAS, type MotivoCambio } from '@eco/shared/realtime';
import type { TicketResumen } from '@eco/shared/schemas';
import type { Encolador } from './colas';
import { activos, staffParticipante, tecnicosDeCategoria, type Destinatario } from './destinatarios';
import { EVENTO_REEVALUAR, type Emisor } from './emisor';

export interface Contexto {
  tx: Tx;
  emisor: Emisor;
  cola: Encolador;
  /** Pide actualizar el tablero (con debounce, después de confirmar). */
  tablero: () => void;
  /** Identifica el evento del outbox en las claves de los trabajos. */
  clave: string;
  agrupadoSeg?: number;
}

/** Una sola emisión a varias salas: cada socket la recibe una vez. */
const salasTicket = (t: TicketResumen) => [SALAS.tecnicos, SALAS.ticket(t.id), SALAS.usuario(t.solicitante.id)];

const sin = <T>(lista: readonly T[], excluido: T | null | undefined) => lista.filter((x) => x !== excluido);

async function actualizado(c: Contexto, t: TicketResumen, motivos: MotivoCambio[], actorId: string | null) {
  await c.emisor.emitir(salasTicket(t), 'ticket:actualizado', { ticket: t, motivos, actorId });
}

async function notificar(
  c: Contexto,
  usuarioIds: readonly string[],
  tipo: TipoNotificacion,
  t: TicketResumen,
  texto: string,
) {
  const payload = { ticketId: t.id, codigo: t.codigo, titulo: t.titulo, texto };
  const creadas = await crearNotificaciones(
    c.tx,
    usuarioIds.map((usuarioId) => ({ usuarioId, tipo, payload })),
  );
  for (const { usuarioId, notificacion } of creadas)
    await c.emisor.emitir(SALAS.usuario(usuarioId), 'notificacion:nueva', { notificacion });
}

async function pedirAsignacion(c: Contexto, t: TicketResumen) {
  if (t.estado !== 'nuevo' || t.asignado) return;
  // `autoasignar` decide según el modo de la categoría; en `manual` no hace nada.
  await c.cola.asignacion({ ticketId: t.id }, { clave: `${c.clave}|${t.id}` });
}

const MOTIVOS: Record<keyof CambiosTicket, MotivoCambio> = {
  estado: 'estado',
  prioridad: 'prioridad',
  asignado: 'asignacion',
  categoria: 'categoria',
  orden: 'orden',
  calificacion: 'calificacion',
  primeraRespuesta: 'sla',
};

type Manejadores = { [T in TipoEventoDominio]: (p: EventosDominio[T], c: Contexto) => Promise<void> };

const manejadores: Manejadores = {
  'ticket.creado': async ({ ticketId, actorId }, c) => {
    const t = await obtenerTicketResumen(c.tx, ticketId);
    if (!t) return;
    await c.emisor.emitir(salasTicket(t), 'ticket:creado', { ticket: t, actorId });
    c.tablero();

    const tecnicos = sin(await tecnicosDeCategoria(c.tx, t.categoriaId), actorId);
    await notificar(c, tecnicos, 'ticket_creado', t, `Nuevo pedido de ${t.solicitante.nombre}`);
    // El solicitante recibe el comprobante del alta aunque la haya originado.
    for (const u of await activos(c.tx, [t.solicitante.id, ...tecnicos]))
      await c.cola.mail(
        { clase: 'ticket_creado', ticketId, usuarioId: u.id },
        { clave: `${c.clave}|${u.id}` },
      );
    await pedirAsignacion(c, t);
  },

  'ticket.actualizado': async ({ ticketId, actorId, cambios }, c) => {
    const t = await obtenerTicketResumen(c.tx, ticketId);
    if (!t) return;
    const motivos = (Object.keys(cambios) as (keyof CambiosTicket)[]).map((k) => MOTIVOS[k]);
    await actualizado(c, t, motivos, actorId);
    c.tablero();

    const avisados = new Set<string>();
    if (cambios.asignado) {
      const { de, a } = cambios.asignado;
      for (const id of [de, a])
        if (id) await c.emisor.emitir(SALAS.usuario(id), 'no-leidos:actualizar', { ticketId });
      const [nuevo] = await activos(c.tx, [a]);
      if (nuevo && esStaff(nuevo) && nuevo.id !== actorId) {
        avisados.add(nuevo.id);
        await notificar(c, [nuevo.id], 'ticket_asignado', t, 'Se le asignó este pedido.');
        await c.cola.mail(
          { clase: 'ticket_asignado', ticketId, usuarioId: nuevo.id },
          { clave: `${c.clave}|${nuevo.id}` },
        );
      }
    }

    if (cambios.estado) {
      const { de, a } = cambios.estado;
      const interesados = await activos(c.tx, [t.solicitante.id, t.asignado?.id]);
      for (const u of interesados) {
        if (u.id === actorId || avisados.has(u.id)) continue;
        // El asignado que además no es el solicitante solo interesa si sigue siendo staff.
        if (u.id !== t.solicitante.id && !esStaff(u)) continue;
        const resuelto = a === 'resuelto' && u.id === t.solicitante.id;
        await notificar(
          c,
          [u.id],
          resuelto ? 'ticket_resuelto' : 'estado_cambiado',
          t,
          resuelto
            ? 'Su pedido fue resuelto. Puede calificar la atención.'
            : `El pedido pasó a «${ETIQUETA_ESTADO[a]}».`,
        );
        await c.cola.mail(
          resuelto
            ? { clase: 'ticket_resuelto', ticketId, usuarioId: u.id }
            : { clase: 'estado_cambiado', ticketId, usuarioId: u.id, de, a },
          { clave: `${c.clave}|${u.id}` },
        );
      }
    }

    if (cambios.categoria) await pedirAsignacion(c, t);
  },

  'mensaje.creado': async ({ mensajeId }, c) => {
    const mensaje = await obtenerMensaje(c.tx, mensajeId);
    if (!mensaje) return;
    const t = await obtenerTicketResumen(c.tx, mensaje.ticketId);
    if (!t) return;
    const autorId = mensaje.autor.id;
    // La visibilidad se toma de la fila, no del evento.
    const { interno } = mensaje;
    if (interno) await c.emisor.emitir(SALAS.ticketInterno(t.id), 'mensaje:nuevo', { mensaje });
    else {
      await c.emisor.emitir(salasTicket(t), 'mensaje:nuevo', { mensaje });
      await actualizado(c, t, ['mensaje'], autorId);
    }

    const staff = await staffParticipante(c.tx, t.id);
    let candidatos: Destinatario[] = await activos(c.tx, [t.solicitante.id, t.asignado?.id, ...staff]);
    if (!candidatos.some((u) => u.id !== autorId && esStaff(u)) && !t.asignado && autorId === t.solicitante.id)
      candidatos = candidatos.concat(await activos(c.tx, await tecnicosDeCategoria(c.tx, t.categoriaId)));
    const destinatarios = [...new Map(candidatos.map((u) => [u.id, u])).values()].filter(
      // El solicitante lo sigue siendo aunque no sea staff; el resto debe serlo.
      (u) => u.id !== autorId && (esStaff(u) || (!interno && u.id === t.solicitante.id)),
    );

    for (const u of destinatarios)
      await c.emisor.emitir(SALAS.usuario(u.id), 'no-leidos:actualizar', { ticketId: t.id });
    await notificar(
      c,
      destinatarios.map((u) => u.id),
      'mensaje_nuevo',
      t,
      interno ? `${mensaje.autor.nombre} agregó una nota interna.` : `${mensaje.autor.nombre}: ${extracto(mensaje.cuerpo, 120)}`,
    );
    // Las notas internas no se envían por correo.
    if (interno) return;
    for (const u of destinatarios)
      await c.cola.mail(
        { clase: 'mensajes', ticketId: t.id, usuarioId: u.id, desde: mensaje.creadoAt },
        {
          clave: `${c.clave}|${u.id}`,
          agrupar: `mensajes|${t.id}|${u.id}`,
          demoraSeg: c.agrupadoSeg ?? AGRUPADO_MENSAJES_SEG,
        },
      );
  },

  'mensaje.editado': async ({ mensajeId }, c) => {
    const mensaje = await obtenerMensaje(c.tx, mensajeId);
    if (!mensaje) return;
    const t = await obtenerTicketResumen(c.tx, mensaje.ticketId);
    if (!t) return;
    if (mensaje.interno) await c.emisor.emitir(SALAS.ticketInterno(t.id), 'mensaje:editado', { mensaje });
    else {
      await c.emisor.emitir(salasTicket(t), 'mensaje:editado', { mensaje });
      await actualizado(c, t, ['mensaje'], mensaje.autor.id);
    }
  },

  'adjunto.creado': async ({ adjuntoId, actorId }, c) => {
    const adjunto = await obtenerAdjunto(c.tx, adjuntoId);
    if (!adjunto) return;
    const t = await obtenerTicketResumen(c.tx, adjunto.ticketId);
    if (!t) return;
    const datos = { ticketId: t.id, adjuntoId };
    if (adjunto.interno) await c.emisor.emitir(SALAS.ticketInterno(t.id), 'adjunto:nuevo', datos);
    else {
      await c.emisor.emitir(salasTicket(t), 'adjunto:nuevo', datos);
      await actualizado(c, t, ['adjunto'], actorId);
    }
  },

  'lectura.actualizada': async ({ ticketId, usuarioId }, c) => {
    await c.emisor.emitir(SALAS.usuario(usuarioId), 'no-leidos:actualizar', { ticketId });
  },

  'notificaciones.actualizadas': async ({ usuarioId }, c) => {
    await c.emisor.emitir(SALAS.usuario(usuarioId), 'notificaciones:actualizar', {});
  },

  'sla.alerta': async ({ ticketId, nivel, clase }, c) => {
    const t = await obtenerTicketResumen(c.tx, ticketId);
    if (!t) return;
    // La alerta es un asunto del equipo técnico.
    await c.emisor.emitir([SALAS.tecnicos, SALAS.ticketInterno(t.id)], 'ticket:actualizado', {
      ticket: t,
      motivos: ['sla'],
      actorId: null,
    });
    c.tablero();

    let destinatarios = (await activos(c.tx, [t.asignado?.id])).filter(esStaff);
    if (!destinatarios.length)
      destinatarios = await activos(c.tx, await tecnicosDeCategoria(c.tx, t.categoriaId));
    const plazo = clase === 'respuesta' ? 'primera respuesta' : 'resolución';
    await notificar(
      c,
      destinatarios.map((u) => u.id),
      nivel === 'vencido' ? 'sla_vencido' : 'sla_por_vencer',
      t,
      nivel === 'vencido' ? `Venció el plazo de ${plazo}.` : `Está por vencer el plazo de ${plazo}.`,
    );
    for (const u of destinatarios)
      await c.cola.mail(
        { clase: 'sla', ticketId, usuarioId: u.id, nivel, claseSla: clase },
        { clave: `${c.clave}|${u.id}` },
      );
  },

  'catalogo.actualizado': async ({ recurso }, c) => {
    // `solicitanteVeArea` cambia quién puede estar en cada sala.
    if (recurso === 'configuracion') await c.emisor.entreServidores(EVENTO_REEVALUAR);
    await c.emisor.emitir(SALAS.todos, 'catalogo:actualizado', { recurso });
  },

  'auth.recuperacion_solicitada': async ({ recuperacionId }, c) => {
    await c.cola.mail({ clase: 'recuperar_password', recuperacionId }, { clave: `recuperacion|${recuperacionId}` });
  },

  'usuario.acceso_cambiado': async ({ usuarioId }, c) => {
    await c.emisor.desconectar(SALAS.usuario(usuarioId));
  },
};

export async function traducir(evento: OutboxFila, contexto: Contexto): Promise<void> {
  const manejar = manejadores[evento.tipo] as
    | ((p: Record<string, unknown>, c: Contexto) => Promise<void>)
    | undefined;
  // Un tipo desconocido (versión más nueva de la API) falla y se reintenta.
  if (!manejar) throw new Error(`Evento desconocido: ${evento.tipo}`);
  await manejar(evento.payload, contexto);
}
