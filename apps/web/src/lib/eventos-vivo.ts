/** Traducción de cada evento del servidor a cambios en la caché. Sin debounce: se aplica al instante. */
import type { QueryClient } from '@tanstack/react-query';
import type { EventosServidor, MotivoCambio } from '@eco/shared/realtime';
import type { TicketDetalle, TicketResumen } from '@eco/shared/schemas';
import { insertarMensaje, insertarNotificacion, type DatosKanban, type DatosMensajes, type DatosNotificaciones, aplicarEnKanban } from './cache';
import { claves } from './consultas';
import { escribirTicket } from './optimista';
import { fijarEscribiendo, presencia } from './vivo';

export interface ContextoVivo {
  usuarioId: string;
  /** Aviso a técnicos: ticket nuevo o que pasó a crítico. */
  alertar?: (t: TicketResumen, motivo: 'nuevo' | 'critico') => void;
}

const CAMBIAN_PERTENENCIA: MotivoCambio[] = ['creado', 'estado', 'asignacion', 'prioridad', 'categoria'];
const CAMBIAN_DETALLE: MotivoCambio[] = ['estado', 'categoria', 'calificacion', 'adjunto'];
const CAMBIAN_HISTORIAL: MotivoCambio[] = ['estado', 'asignacion', 'prioridad', 'categoria', 'calificacion', 'sla'];

export function crearManejadores(qc: QueryClient, ctx: ContextoVivo): EventosServidor {
  const invalidar = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });
  const detalleDe = (id: string) => ({
    queryKey: claves.detalles,
    predicate: (q: { state: { data: unknown } }) => (q.state.data as TicketDetalle | undefined)?.id === id,
  });

  return {
    'ticket:creado': ({ ticket, actorId }) => {
      const nuevo = !qc.getQueryData<DatosKanban>(claves.kanban)?.tickets.some((t) => t.id === ticket.id);
      qc.setQueryData<DatosKanban>(claves.kanban, (d) => (d ? aplicarEnKanban(d, ticket) : d));
      invalidar(claves.listas);
      if (nuevo && actorId !== ctx.usuarioId) ctx.alertar?.(ticket, ticket.prioridad === 'critica' ? 'critico' : 'nuevo');
    },
    'ticket:actualizado': ({ ticket, motivos, actorId }) => {
      escribirTicket(qc, ticket);
      if (motivos.some((m) => CAMBIAN_PERTENENCIA.includes(m))) invalidar(claves.listas);
      if (motivos.some((m) => CAMBIAN_DETALLE.includes(m))) void qc.invalidateQueries(detalleDe(ticket.id));
      if (motivos.some((m) => CAMBIAN_HISTORIAL.includes(m))) invalidar(claves.eventos(ticket.id));
      if (motivos.includes('prioridad') && ticket.prioridad === 'critica' && actorId !== ctx.usuarioId)
        ctx.alertar?.(ticket, 'critico');
    },
    'mensaje:nuevo': ({ mensaje }) => {
      qc.setQueryData<DatosMensajes>(claves.mensajes(mensaje.ticketId), (d) =>
        d ? { ...d, items: insertarMensaje(d.items, mensaje) } : d,
      );
      fijarEscribiendo(mensaje.ticketId, mensaje.autor, false, mensaje.interno);
      if (mensaje.adjuntos.length) void qc.invalidateQueries(detalleDe(mensaje.ticketId));
    },
    'mensaje:editado': ({ mensaje }) => {
      qc.setQueryData<DatosMensajes>(claves.mensajes(mensaje.ticketId), (d) =>
        d ? { ...d, items: insertarMensaje(d.items, mensaje) } : d,
      );
    },
    'adjunto:nuevo': ({ ticketId }) => {
      invalidar(claves.mensajes(ticketId));
      void qc.invalidateQueries(detalleDe(ticketId));
    },
    'no-leidos:actualizar': () => invalidar(claves.noLeidos),
    'notificacion:nueva': ({ notificacion }) => {
      qc.setQueryData<DatosNotificaciones>(claves.notificaciones, (d) =>
        d ? insertarNotificacion(d, notificacion) : d,
      );
    },
    'notificaciones:actualizar': () => invalidar(claves.notificaciones),
    'tablero:actualizar': () => invalidar(claves.estadisticas),
    'catalogo:actualizado': () => {
      invalidar(claves.catalogo);
      invalidar(claves.usuarios);
    },
    escribiendo: (p) => {
      if (p.usuario.id !== ctx.usuarioId) fijarEscribiendo(p.ticketId, p.usuario, p.escribiendo, p.interno);
    },
    presencia: ({ ticketId, usuarios }) => presencia.fijar((v) => ({ ...v, [ticketId]: usuarios })),
  };
}
