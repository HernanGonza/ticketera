export const COLAS = {
  mail: 'notificaciones-mail',
  sla: 'sla',
  autocierre: 'autocierre',
  asignacion: 'asignacion-automatica',
  outbox: 'outbox-publisher',
  limpieza: 'limpieza',
} as const;
export type NombreCola = (typeof COLAS)[keyof typeof COLAS];

export type TrabajoMail =
  | { clase: 'ticket_creado'; ticketId: string; usuarioId: string }
  | { clase: 'ticket_asignado'; ticketId: string; usuarioId: string }
  | { clase: 'estado_cambiado'; ticketId: string; usuarioId: string; de: string; a: string }
  | { clase: 'ticket_resuelto'; ticketId: string; usuarioId: string }
  /** Agrupado: un solo trabajo por ticket y destinatario cada 2 minutos; envía todo lo no leído desde `desde`. */
  | { clase: 'mensajes'; ticketId: string; usuarioId: string; desde: string }
  | { clase: 'sla'; ticketId: string; usuarioId: string; nivel: 'por_vencer' | 'vencido'; claseSla: 'respuesta' | 'resolucion' }
  | { clase: 'recuperar_password'; recuperacionId: string };

export interface TrabajoAsignacion {
  ticketId: string;
}
export const AGRUPADO_MENSAJES_SEG = 120;
