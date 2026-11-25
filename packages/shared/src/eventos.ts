/**
 * Eventos de dominio guardados en `outbox_eventos` (misma transacción que la mutación).
 * El publicador del worker los traduce a eventos de Socket.IO, trabajos de cola y notificaciones.
 */
import type { Estado, Prioridad } from './dominio/tipos';

export interface CambiosTicket {
  estado?: { de: Estado; a: Estado };
  prioridad?: { de: Prioridad; a: Prioridad };
  asignado?: { de: string | null; a: string | null };
  categoria?: { de: number; a: number };
  orden?: true;
  calificacion?: true;
  primeraRespuesta?: true;
}

export interface EventosDominio {
  'ticket.creado': { ticketId: string; actorId: string };
  /** `actorId` null = acción automática del sistema. */
  'ticket.actualizado': { ticketId: string; actorId: string | null; cambios: CambiosTicket };
  'mensaje.creado': { ticketId: string; mensajeId: string; actorId: string; interno: boolean };
  'mensaje.editado': { ticketId: string; mensajeId: string; actorId: string; interno: boolean };
  'adjunto.creado': { ticketId: string; adjuntoId: string; actorId: string; interno: boolean };
  'lectura.actualizada': { ticketId: string; usuarioId: string };
  'notificaciones.actualizadas': { usuarioId: string };
  'sla.alerta': { ticketId: string; nivel: 'por_vencer' | 'vencido'; clase: 'respuesta' | 'resolucion' };
  'catalogo.actualizado': { recurso: 'categorias' | 'areas' | 'usuarios' | 'configuracion' | 'respuestas' };
  /** El worker genera el token de un solo uso al enviar el mail (nunca se persiste en claro). */
  'auth.recuperacion_solicitada': { recuperacionId: string };
  /** El usuario perdió acceso o cambió de rol: la API debe desconectar sus sockets. */
  'usuario.acceso_cambiado': { usuarioId: string };
}
export type TipoEventoDominio = keyof EventosDominio;
export type EventoDominio = { [K in TipoEventoDominio]: { tipo: K; payload: EventosDominio[K] } }[TipoEventoDominio];

/** Canal de LISTEN/NOTIFY que despierta al publicador. */
export const CANAL_OUTBOX = 'eco_outbox';
