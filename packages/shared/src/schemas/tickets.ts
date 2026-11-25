import { z } from 'zod';
import { TIPOS_EVENTO, TIPOS_NOTIFICACION } from '../dominio/tipos';
import { zEstado, zFecha, zId, zIdNum, zPersona, zPrioridad } from './comunes';

export const zAdjunto = z.object({
  id: zId,
  ticketId: zId,
  mensajeId: zId.nullable(),
  nombre: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  interno: z.boolean(),
  subidoPor: zPersona,
  creadoAt: zFecha,
});
export type Adjunto = z.infer<typeof zAdjunto>;

/** Tarjeta/fila de ticket. Se envía igual por REST y por Socket.IO: no contiene datos internos ni propios de un usuario. */
export const zTicketResumen = z.object({
  id: zId,
  codigo: z.string(),
  titulo: z.string(),
  estado: zEstado,
  prioridad: zPrioridad,
  categoriaId: z.number().int(),
  categoriaNombre: z.string(),
  categoriaIcono: z.string(),
  areaId: z.number().int().nullable(),
  areaNombre: z.string().nullable(),
  solicitante: zPersona,
  asignado: zPersona.nullable(),
  ordenKanban: z.number(),
  creadoAt: zFecha,
  actualizadoAt: zFecha,
  primeraRespuestaAt: zFecha.nullable(),
  resueltoAt: zFecha.nullable(),
  venceRespuestaAt: zFecha.nullable(),
  venceResolucionAt: zFecha.nullable(),
  slaRespuestaMin: z.number().int(),
  slaResolucionMin: z.number().int(),
  enEsperaDesde: zFecha.nullable(),
  /** Último mensaje público (las notas internas nunca aparecen acá). */
  ultimoMensaje: z.object({ autorNombre: z.string(), extracto: z.string(), creadoAt: zFecha }).nullable(),
  version: z.number().int(),
});
export type TicketResumen = z.infer<typeof zTicketResumen>;

export const zTicketDetalle = zTicketResumen.extend({
  descripcion: z.string(),
  ubicacion: z.string().nullable(),
  datos: z.record(z.string(), z.unknown()),
  solicitanteEmail: z.string(),
  cerradoAt: zFecha.nullable(),
  minutosEnEspera: z.number().int(),
  reabierto: z.number().int(),
  calificacion: z.number().int().nullable(),
  comentarioCalificacion: z.string().nullable(),
  /** Todos los adjuntos visibles para quien consulta (del ticket y de mensajes). */
  adjuntos: z.array(zAdjunto),
});
export type TicketDetalle = z.infer<typeof zTicketDetalle>;

export const zMensaje = z.object({
  id: zId,
  ticketId: zId,
  autor: zPersona.extend({ esStaff: z.boolean() }),
  cuerpo: z.string(),
  interno: z.boolean(),
  /** Id generado por el cliente para conciliar el envío optimista. */
  clienteId: z.string().nullable(),
  creadoAt: zFecha,
  editadoAt: zFecha.nullable(),
  adjuntos: z.array(zAdjunto),
});
export type Mensaje = z.infer<typeof zMensaje>;

export const zTicketEvento = z.object({
  id: z.number().int(),
  ticketId: zId,
  tipo: z.enum(TIPOS_EVENTO),
  de: z.string().nullable(),
  a: z.string().nullable(),
  /** Texto legible ya resuelto (nombres de usuarios/categorías). */
  deTexto: z.string().nullable(),
  aTexto: z.string().nullable(),
  usuario: zPersona.nullable(),
  fecha: zFecha,
});
export type TicketEvento = z.infer<typeof zTicketEvento>;

export const zCrearTicket = z.object({
  categoriaId: z.number().int().positive(),
  titulo: z.string().trim().min(4, 'Escriba un título de al menos 4 caracteres').max(150),
  descripcion: z.string().trim().min(5, 'Describa el problema').max(10_000),
  ubicacion: z.string().trim().max(120).optional(),
  datos: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}),
});
export type CrearTicket = z.input<typeof zCrearTicket>;

export const AMBITOS = ['mios', 'area', 'todos'] as const;
export const ORDENES = ['creadoAt', 'actualizadoAt', 'codigo', 'prioridad', 'estado', 'venceResolucionAt', 'titulo'] as const;
const zLista = <T extends z.ZodType>(t: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')), z.array(t).optional());
const zBoolQuery = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean().optional());

/** GET /api/tickets — para solicitantes `todos` se trata como sus visibles. */
export const zFiltroTickets = z.object({
  ambito: z.enum(AMBITOS).default('mios'),
  estado: zLista(zEstado),
  prioridad: zLista(zPrioridad),
  areaId: zIdNum.optional(),
  categoriaId: zIdNum.optional(),
  asignadoId: zId.optional(),
  sinAsignar: zBoolQuery,
  vencidos: zBoolQuery,
  q: z.string().trim().max(100).optional(),
  orden: z.enum(ORDENES).default('actualizadoAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(500).default(25),
});
export type FiltroTickets = z.input<typeof zFiltroTickets>;
export const zPaginaTickets = z.object({ items: z.array(zTicketResumen), total: z.number().int() });
export const zKanban = z.object({ tickets: z.array(zTicketResumen) });

/** PATCH /api/tickets/:id — cambios de gestión (staff) o de estado (dueño). Control optimista por `version`. */
export const zActualizarTicket = z.object({
  version: z.number().int(),
  estado: zEstado.optional(),
  prioridad: zPrioridad.optional(),
  categoriaId: z.number().int().positive().optional(),
  asignadoId: zId.nullable().optional(),
});
export type ActualizarTicket = z.infer<typeof zActualizarTicket>;

/**
 * PATCH /api/tickets/:id/mover (staff). `antesDeId` = tarjeta que queda inmediatamente debajo;
 * `despuesDeId` = tarjeta que queda inmediatamente arriba. Sin ninguno: al principio de la columna.
 * El servidor calcula `ordenKanban`.
 */
export const zMoverTicket = z.object({
  version: z.number().int(),
  estado: zEstado,
  antesDeId: zId.nullable().optional(),
  despuesDeId: zId.nullable().optional(),
});
export type MoverTicket = z.infer<typeof zMoverTicket>;

/** POST /api/tickets/masivo (staff) */
export const zAccionMasiva = z.object({
  ids: z.array(zId).min(1).max(200),
  cambios: z
    .object({ estado: zEstado.optional(), prioridad: zPrioridad.optional(), asignadoId: zId.nullable().optional() })
    .refine((c) => Object.values(c).some((v) => v !== undefined), 'Indique al menos un cambio'),
});
export const zResultadoMasivo = z.object({
  actualizados: z.array(zId),
  errores: z.array(z.object({ id: zId, mensaje: z.string() })),
});

export const zCrearMensaje = z.object({
  cuerpo: z.string().trim().min(1).max(10_000),
  interno: z.boolean().default(false),
  clienteId: z.string().max(60).optional(),
});
export const zEditarMensaje = z.object({ cuerpo: z.string().trim().min(1).max(10_000) });
export const zLectura = z.object({ ultimoMensajeId: zId });
export const zCalificar = z.object({
  calificacion: z.number().int().min(1).max(5),
  comentario: z.string().trim().max(1000).optional(),
});
export const zReabrir = z.object({ version: z.number().int(), motivo: z.string().trim().max(2000).optional() });

/** GET /api/no-leidos */
export const zNoLeidos = z.object({ total: z.number().int(), porTicket: z.record(z.string(), z.number().int()) });
export type NoLeidos = z.infer<typeof zNoLeidos>;

export const zNotificacion = z.object({
  id: z.number().int(),
  tipo: z.enum(TIPOS_NOTIFICACION),
  payload: z.object({ ticketId: zId, codigo: z.string(), titulo: z.string(), texto: z.string() }),
  leida: z.boolean(),
  creadaAt: zFecha,
});
export type Notificacion = z.infer<typeof zNotificacion>;
export const zListaNotificaciones = z.object({ items: z.array(zNotificacion), sinLeer: z.number().int() });
export const zMarcarNotificaciones = z.object({ ids: z.array(z.number().int()).max(500).optional() });
