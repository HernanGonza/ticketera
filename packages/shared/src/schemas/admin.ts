import { z } from 'zod';
import { zEmail, zFecha, zId, zPersona, zPrioridad, zRol } from './comunes';
import { zPasswordNueva } from './auth';

export const TIPOS_CAMPO = ['texto', 'texto_largo', 'numero', 'seleccion', 'casilla', 'fecha'] as const;
export const zCampoExtra = z.object({
  clave: z.string().regex(/^[a-z0-9_]{1,40}$/, 'Use minúsculas, números y guion bajo'),
  etiqueta: z.string().trim().min(1).max(80),
  tipo: z.enum(TIPOS_CAMPO),
  requerido: z.boolean().default(false),
  opciones: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  ayuda: z.string().max(200).optional(),
});
export type CampoExtra = z.infer<typeof zCampoExtra>;

export const MODOS_ASIGNACION = ['manual', 'fija', 'round_robin'] as const;

export const zGuardarCategoria = z.object({
  nombre: z.string().trim().min(2).max(80),
  descripcion: z.string().trim().max(200).default(''),
  /** Nombre de ícono de lucide en kebab-case (ver ICONOS_CATEGORIA). */
  icono: z.string().max(40),
  padreId: z.number().int().positive().nullable().default(null),
  prioridadDefault: zPrioridad,
  slaRespuestaMin: z.number().int().min(5).max(100_000),
  slaResolucionMin: z.number().int().min(5).max(100_000),
  campos: z.array(zCampoExtra).max(20).default([]),
  modoAsignacion: z.enum(MODOS_ASIGNACION).default('manual'),
  tecnicoDefaultId: zId.nullable().default(null),
  activa: z.boolean().default(true),
});
export type GuardarCategoria = z.input<typeof zGuardarCategoria>;
export const zCategoria = zGuardarCategoria.required().extend({ id: z.number().int(), orden: z.number().int() });
export type Categoria = z.infer<typeof zCategoria>;
export const zOrdenCategorias = z.object({ ids: z.array(z.number().int()).min(1) });

export const ICONOS_CATEGORIA = [
  'network', 'wifi', 'monitor-x', 'printer', 'mail', 'user-cog', 'app-window', 'phone',
  'package-plus', 'projector', 'cctv', 'circle-help', 'laptop', 'hard-drive', 'keyboard', 'server',
  'shield', 'database', 'globe', 'wrench',
] as const;

export const zArea = z.object({ id: z.number().int(), nombre: z.string(), activo: z.boolean() });
export type Area = z.infer<typeof zArea>;
export const zGuardarArea = z.object({ nombre: z.string().trim().min(2).max(120), activo: z.boolean().default(true) });

export const zUsuario = z.object({
  id: zId,
  email: z.string(),
  nombre: z.string(),
  rol: zRol,
  areaId: z.number().int().nullable(),
  areaNombre: z.string().nullable(),
  activo: z.boolean(),
  tienePassword: z.boolean(),
  ultimoAcceso: zFecha.nullable(),
});
export type Usuario = z.infer<typeof zUsuario>;
export const zCrearUsuario = z.object({
  email: zEmail,
  nombre: z.string().trim().min(2).max(120),
  rol: zRol,
  areaId: z.number().int().nullable(),
  password: zPasswordNueva.optional(),
});
export const zActualizarUsuario = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  rol: zRol.optional(),
  areaId: z.number().int().nullable().optional(),
  activo: z.boolean().optional(),
  password: zPasswordNueva.optional(),
});
export const zFiltroUsuarios = z.object({
  q: z.string().trim().max(100).optional(),
  rol: zRol.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});
export const zPaginaUsuarios = z.object({ items: z.array(zUsuario), total: z.number().int() });

const zHora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:mm');
export const zCalendario = z
  .object({
    dias: z.array(z.number().int().min(0).max(6)).min(1),
    desde: zHora,
    hasta: zHora,
    feriados: z.array(z.iso.date()).max(400),
  })
  .refine((c) => c.hasta > c.desde, 'La hora de fin debe ser posterior a la de inicio');

/** Claves de la tabla `configuracion`. */
export const zConfiguracion = z.object({
  calendario: zCalendario,
  horasAutocierre: z.number().int().min(1).max(720),
  solicitanteVeArea: z.boolean(),
  adjuntoMaxMb: z.number().int().min(1).max(50),
});
export type Configuracion = z.infer<typeof zConfiguracion>;
export const CONFIGURACION_DEFAULT: Configuracion = {
  calendario: { dias: [1, 2, 3, 4, 5], desde: '07:00', hasta: '19:00', feriados: [] },
  horasAutocierre: 72,
  solicitanteVeArea: true,
  adjuntoMaxMb: 10,
};

export const zRespuestaRapida = z.object({ id: z.number().int(), titulo: z.string(), cuerpo: z.string() });
export type RespuestaRapida = z.infer<typeof zRespuestaRapida>;
export const zGuardarRespuestaRapida = z.object({
  titulo: z.string().trim().min(2).max(80),
  cuerpo: z.string().trim().min(1).max(5000),
});

/** GET /api/catalogo — datos base de la app. `tecnicos` y `respuestasRapidas` vienen vacíos para solicitantes. */
export const zCatalogo = z.object({
  areas: z.array(zArea),
  categorias: z.array(zCategoria),
  tecnicos: z.array(zPersona),
  respuestasRapidas: z.array(zRespuestaRapida),
  configuracion: zConfiguracion,
});
export type Catalogo = z.infer<typeof zCatalogo>;

export const ESTADOS_TRABAJO = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as const;
export const zResumenCola = z.object({
  nombre: z.string(),
  pendientes: z.number().int(),
  activos: z.number().int(),
  completados: z.number().int(),
  fallidos: z.number().int(),
  cancelados: z.number().int(),
});
export type ResumenCola = z.infer<typeof zResumenCola>;
export const zTrabajo = z.object({
  id: z.string(),
  cola: z.string(),
  estado: z.enum(ESTADOS_TRABAJO),
  datos: z.unknown(),
  salida: z.unknown(),
  intentos: z.number().int(),
  maxIntentos: z.number().int(),
  creadoAt: zFecha,
  iniciadoAt: zFecha.nullable(),
  finalizadoAt: zFecha.nullable(),
});
export type Trabajo = z.infer<typeof zTrabajo>;
export const zFiltroTrabajos = z.object({
  estado: z.enum(ESTADOS_TRABAJO).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
