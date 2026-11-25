import type { Mensaje, Notificacion, TicketResumen } from './schemas/tickets';

export const SALAS = {
  /** Todos los autenticados */
  todos: 'todos',
  tecnicos: 'tecnicos',
  tablero: 'tablero',
  ticket: (id: string) => `ticket:${id}`,
  /** Solo staff: notas internas y sus adjuntos */
  ticketInterno: (id: string) => `ticket:${id}:interno`,
  usuario: (id: string) => `usuario:${id}`,
} as const;

export interface UsuarioPresente {
  id: string;
  nombre: string;
}

export type MotivoCambio =
  | 'creado'
  | 'estado'
  | 'asignacion'
  | 'prioridad'
  | 'categoria'
  | 'orden'
  | 'mensaje'
  | 'adjunto'
  | 'calificacion'
  | 'sla';

export interface EventosServidor {
  /** `todos`/`usuario:{id}`/`ticket:{id}`: el cliente debe aplicar solo si `version` >= la que tiene. */
  'ticket:creado': (p: { ticket: TicketResumen; actorId: string }) => void;
  'ticket:actualizado': (p: { ticket: TicketResumen; motivos: MotivoCambio[]; actorId: string | null }) => void;
  'mensaje:nuevo': (p: { mensaje: Mensaje }) => void;
  'mensaje:editado': (p: { mensaje: Mensaje }) => void;
  'adjunto:nuevo': (p: { ticketId: string; adjuntoId: string }) => void;
  /** A `usuario:{id}`: cambió su contador de no leídos. */
  'no-leidos:actualizar': (p: { ticketId: string }) => void;
  'notificacion:nueva': (p: { notificacion: Notificacion }) => void;
  'notificaciones:actualizar': (p: Record<string, never>) => void;
  /** A `tablero` (con debounce): volver a pedir estadísticas. */
  'tablero:actualizar': (p: Record<string, never>) => void;
  'catalogo:actualizado': (p: { recurso: string }) => void;
  escribiendo: (p: { ticketId: string; usuario: UsuarioPresente; escribiendo: boolean; interno: boolean }) => void;
  presencia: (p: { ticketId: string; usuarios: UsuarioPresente[] }) => void;
}

export interface EventosCliente {
  /** Únicas salas que el cliente puede pedir. `usuario:{id}` y `todos` se asignan al conectar. */
  'sala:unirse': (p: { sala: string }, ack: (r: { ok: boolean }) => void) => void;
  'sala:salir': (p: { sala: string }) => void;
  escribiendo: (p: { ticketId: string; escribiendo: boolean; interno?: boolean }) => void;
}

/**
 * Unirse a `ticket:{id}` valida `puedeVerTicket`; si es staff, el servidor agrega además
 * `ticket:{id}:interno`. `tecnicos` y `tablero` solo staff.
 */
export const SOCKET_PATH = '/socket.io';
/** Desconectar por sesión vencida: el cliente refresca la sesión y reconecta. */
export const ERROR_SOCKET_NO_AUTENTICADO = 'no_autenticado';
