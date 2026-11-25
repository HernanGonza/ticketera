/**
 * Esquema Drizzle de ECOsoporte. Columnas SQL en snake_case, propiedades en camelCase.
 * Tras modificarlo: `npm run db:generate`. Triggers, funciones y vistas viven en migraciones SQL propias.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { ESTADOS, PRIORIDADES, ROLES, type TipoEvento, type TipoNotificacion } from '@eco/shared/dominio';
import type { TipoEventoDominio } from '@eco/shared/eventos';
import type { CampoExtra, MODOS_ASIGNACION, Notificacion } from '@eco/shared/schemas';

/** El orden de declaración de los enums es el orden semántico (sirve para `order by`). */
export const rolEnum = pgEnum('rol', ROLES);
export const estadoEnum = pgEnum('estado_ticket', ESTADOS);
export const prioridadEnum = pgEnum('prioridad', PRIORIDADES);
export const modoAsignacionEnum = pgEnum('modo_asignacion', ['manual', 'fija', 'round_robin']);
export type ModoAsignacion = (typeof MODOS_ASIGNACION)[number];

/** `clase:nivel` de las alertas de SLA ya emitidas (p. ej. `resolucion:vencido`). */
export type AlertaSla = `${'respuesta' | 'resolucion'}:${'por_vencer' | 'vencido'}`;

const fecha = (nombre: string) => timestamp(nombre, { withTimezone: true });

export const areas = pgTable(
  'areas',
  {
    id: serial('id').primaryKey(),
    nombre: text('nombre').notNull(),
    activo: boolean('activo').notNull().default(true),
  },
  (t) => [uniqueIndex('areas_nombre_uq').on(sql`lower(${t.nombre})`)],
);

export const usuarios = pgTable(
  'usuarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Único sin distinguir mayúsculas. Buscar siempre por `lower(email)`. */
    email: text('email').notNull(),
    nombre: text('nombre').notNull(),
    areaId: integer('area_id').references(() => areas.id),
    rol: rolEnum('rol').notNull().default('solicitante'),
    passwordHash: text('password_hash'),
    activo: boolean('activo').notNull().default(true),
    /** Bloqueo puesto por un administrador: Personal no puede reactivar al usuario (decisión 24). */
    bloqueado: boolean('bloqueado').notNull().default(false),
    ultimoAcceso: fecha('ultimo_acceso'),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
    actualizadoAt: fecha('actualizado_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usuarios_email_lower_uq').on(sql`lower(${t.email})`),
    index('usuarios_rol_idx').on(t.rol).where(sql`${t.activo}`),
    index('usuarios_area_idx').on(t.areaId),
  ],
);

/** Refresh tokens (solo su hash). Cada ingreso abre una `familia`; rotar crea una fila nueva en la misma familia. */
export const sesiones = pgTable(
  'sesiones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    familia: uuid('familia').notNull(),
    tokenHash: text('token_hash').notNull(),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
    expiraAt: fecha('expira_at').notNull(),
    /** Momento en que se rotó: presentarlo de nuevo indica reuso (revocar la familia). */
    usadoAt: fecha('usado_at'),
    revocadoAt: fecha('revocado_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sesiones_token_uq').on(t.tokenHash),
    index('sesiones_usuario_idx').on(t.usuarioId),
    index('sesiones_familia_idx').on(t.familia),
    index('sesiones_expira_idx').on(t.expiraAt),
  ],
);

/** `jti` de tokens del portal ya usados (anti reuso). Insertar con la PK: si choca, es un reuso. */
export const portalJti = pgTable(
  'portal_jti',
  {
    jti: text('jti').primaryKey(),
    expiraAt: fecha('expira_at').notNull(),
  },
  (t) => [index('portal_jti_expira_idx').on(t.expiraAt)],
);

export const recuperacionesPassword = pgTable(
  'recuperaciones_password',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    /** Lo completa el worker al enviar el mail; el token nunca se persiste en claro. */
    tokenHash: text('token_hash'),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
    expiraAt: fecha('expira_at').notNull(),
    usadoAt: fecha('usado_at'),
  },
  (t) => [
    uniqueIndex('recuperaciones_token_uq').on(t.tokenHash),
    index('recuperaciones_usuario_idx').on(t.usuarioId),
    index('recuperaciones_expira_idx').on(t.expiraAt),
  ],
);

export const categorias = pgTable(
  'categorias',
  {
    id: serial('id').primaryKey(),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion').notNull().default(''),
    icono: text('icono').notNull().default('circle-help'),
    padreId: integer('padre_id').references((): AnyPgColumn => categorias.id),
    prioridadDefault: prioridadEnum('prioridad_default').notNull().default('media'),
    slaRespuestaMin: integer('sla_respuesta_min').notNull(),
    slaResolucionMin: integer('sla_resolucion_min').notNull(),
    campos: jsonb('campos').$type<CampoExtra[]>().notNull().default([]),
    modoAsignacion: modoAsignacionEnum('modo_asignacion').notNull().default('manual'),
    tecnicoDefaultId: uuid('tecnico_default_id').references(() => usuarios.id, { onDelete: 'set null' }),
    activa: boolean('activa').notNull().default(true),
    orden: integer('orden').notNull().default(0),
  },
  (t) => [
    uniqueIndex('categorias_nombre_uq').on(sql`lower(${t.nombre})`),
    index('categorias_orden_idx').on(t.orden),
    check('categorias_sla_ck', sql`${t.slaRespuestaMin} > 0 and ${t.slaResolucionMin} > 0`),
  ],
);

/** Último número de ticket emitido por año (lo usa el trigger `tickets_codigo`). */
export const contadoresCodigo = pgTable('contadores_codigo', {
  anio: integer('anio').primaryKey(),
  ultimo: integer('ultimo').notNull(),
});

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `TCK-AAAA-000001`, lo asigna un trigger al insertar (no completarlo). */
    codigo: text('codigo').notNull().default(''),
    titulo: text('titulo').notNull(),
    descripcion: text('descripcion').notNull(),
    categoriaId: integer('categoria_id')
      .notNull()
      .references(() => categorias.id),
    prioridad: prioridadEnum('prioridad').notNull(),
    estado: estadoEnum('estado').notNull().default('nuevo'),
    solicitanteId: uuid('solicitante_id')
      .notNull()
      .references(() => usuarios.id),
    /** Área del solicitante al crear el pedido (histórica). */
    areaId: integer('area_id').references(() => areas.id),
    asignadoId: uuid('asignado_id').references(() => usuarios.id),
    ubicacion: text('ubicacion'),
    datos: jsonb('datos').$type<Record<string, unknown>>().notNull().default({}),
    ordenKanban: numeric('orden_kanban', { mode: 'number' }).notNull().default(0),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
    actualizadoAt: fecha('actualizado_at').notNull().defaultNow(),
    primeraRespuestaAt: fecha('primera_respuesta_at'),
    resueltoAt: fecha('resuelto_at'),
    /** Fecha de cierre o de cancelación. */
    cerradoAt: fecha('cerrado_at'),
    /** Copia de los SLA de la categoría al crear o recategorizar. */
    slaRespuestaMin: integer('sla_respuesta_min').notNull(),
    slaResolucionMin: integer('sla_resolucion_min').notNull(),
    venceRespuestaAt: fecha('vence_respuesta_at'),
    venceResolucionAt: fecha('vence_resolucion_at'),
    /** Minutos hábiles en que el reloj de SLA estuvo detenido (en espera, o resuelto antes de reabrir). */
    minutosEnEspera: integer('minutos_en_espera').notNull().default(0),
    enEsperaDesde: fecha('en_espera_desde'),
    /** Minutos hábiles hasta la primera respuesta, sin tiempos detenidos. */
    minPrimeraRespuesta: integer('min_primera_respuesta'),
    /** Minutos hábiles hasta la resolución, sin tiempos detenidos. */
    minResolucion: integer('min_resolucion'),
    alertasSla: text('alertas_sla').array().$type<AlertaSla[]>().notNull().default(sql`'{}'::text[]`),
    autocierreAt: fecha('autocierre_at'),
    reabierto: integer('reabierto').notNull().default(0),
    calificacion: integer('calificacion'),
    comentarioCalificacion: text('comentario_calificacion'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('tickets_codigo_uq').on(t.codigo),
    index('tickets_kanban_idx').on(t.estado, t.ordenKanban),
    index('tickets_cerrados_idx').on(t.cerradoAt).where(sql`${t.estado} = 'cerrado'`),
    index('tickets_solicitante_idx').on(t.solicitanteId, t.actualizadoAt),
    index('tickets_area_idx').on(t.areaId, t.actualizadoAt),
    index('tickets_asignado_idx').on(t.asignadoId, t.estado),
    index('tickets_categoria_idx').on(t.categoriaId),
    index('tickets_creado_idx').on(t.creadoAt),
    index('tickets_actualizado_idx').on(t.actualizadoAt),
    index('tickets_resuelto_idx').on(t.resueltoAt),
    index('tickets_autocierre_idx').on(t.autocierreAt).where(sql`${t.estado} = 'resuelto'`),
    index('tickets_sla_idx')
      .on(t.venceResolucionAt)
      .where(sql`${t.estado} in ('nuevo','asignado','en_curso','en_espera')`),
    index('tickets_titulo_trgm_idx').using('gin', sql`eco_normalizar(${t.titulo}) gin_trgm_ops`),
    index('tickets_descripcion_trgm_idx').using('gin', sql`eco_normalizar(${t.descripcion}) gin_trgm_ops`),
    index('tickets_codigo_trgm_idx').using('gin', sql`eco_normalizar(${t.codigo}) gin_trgm_ops`),
    check('tickets_calificacion_ck', sql`${t.calificacion} between 1 and 5`),
  ],
);

/** Historial inmutable (un trigger impide modificarlo). */
export const ticketEventos = pgTable(
  'ticket_eventos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    tipo: text('tipo').$type<TipoEvento>().notNull(),
    de: text('de'),
    a: text('a'),
    /** null = sistema */
    usuarioId: uuid('usuario_id').references(() => usuarios.id),
    fecha: fecha('fecha').notNull().defaultNow(),
  },
  (t) => [
    index('ticket_eventos_ticket_idx').on(t.ticketId, t.id),
    index('ticket_eventos_tipo_fecha_idx').on(t.tipo, t.fecha),
  ],
);

export const mensajes = pgTable(
  'mensajes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    autorId: uuid('autor_id')
      .notNull()
      .references(() => usuarios.id),
    cuerpo: text('cuerpo').notNull(),
    interno: boolean('interno').notNull().default(false),
    clienteId: text('cliente_id'),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
    editadoAt: fecha('editado_at'),
  },
  (t) => [
    index('mensajes_ticket_idx').on(t.ticketId, t.creadoAt),
    index('mensajes_publicos_idx').on(t.ticketId, t.creadoAt).where(sql`not ${t.interno}`),
    index('mensajes_autor_idx').on(t.autorId, t.ticketId),
    uniqueIndex('mensajes_cliente_uq')
      .on(t.ticketId, t.autorId, t.clienteId)
      .where(sql`${t.clienteId} is not null`),
  ],
);

export const adjuntos = pgTable(
  'adjuntos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    mensajeId: uuid('mensaje_id').references(() => mensajes.id, { onDelete: 'cascade' }),
    /** Ruta relativa a UPLOADS_DIR, con nombre aleatorio. */
    ruta: text('ruta').notNull(),
    nombre: text('nombre').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    /** Heredado del mensaje: solo visible para staff. */
    interno: boolean('interno').notNull().default(false),
    subidoPorId: uuid('subido_por_id')
      .notNull()
      .references(() => usuarios.id),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
  },
  (t) => [
    index('adjuntos_ticket_idx').on(t.ticketId, t.creadoAt),
    index('adjuntos_mensaje_idx').on(t.mensajeId),
    check('adjuntos_bytes_ck', sql`${t.bytes} >= 0`),
  ],
);

export const lecturas = pgTable(
  'lecturas',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    ultimoMensajeId: uuid('ultimo_mensaje_id').references(() => mensajes.id, { onDelete: 'set null' }),
    /** `creado_at` del último mensaje leído: los posteriores cuentan como no leídos. */
    ultimoMensajeAt: fecha('ultimo_mensaje_at').notNull(),
    leidoAt: fecha('leido_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.ticketId] }), index('lecturas_ticket_idx').on(t.ticketId)],
);

export const notificaciones = pgTable(
  'notificaciones',
  {
    id: serial('id').primaryKey(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    tipo: text('tipo').$type<TipoNotificacion>().notNull(),
    payload: jsonb('payload').$type<Notificacion['payload']>().notNull(),
    leida: boolean('leida').notNull().default(false),
    creadaAt: fecha('creada_at').notNull().defaultNow(),
  },
  (t) => [
    index('notificaciones_usuario_idx').on(t.usuarioId, t.id),
    index('notificaciones_sin_leer_idx').on(t.usuarioId).where(sql`not ${t.leida}`),
  ],
);

export const outboxEventos = pgTable(
  'outbox_eventos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tipo: text('tipo').$type<TipoEventoDominio>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    creadoAt: fecha('creado_at').notNull().defaultNow(),
    publicadoAt: fecha('publicado_at'),
    intentos: integer('intentos').notNull().default(0),
    ultimoError: text('ultimo_error'),
  },
  (t) => [
    index('outbox_pendientes_idx').on(t.id).where(sql`${t.publicadoAt} is null`),
    index('outbox_publicados_idx').on(t.publicadoAt),
  ],
);

export const configuracion = pgTable('configuracion', {
  clave: text('clave').primaryKey(),
  valor: jsonb('valor').notNull(),
  actualizadoAt: fecha('actualizado_at').notNull().defaultNow(),
});

export const respuestasRapidas = pgTable('respuestas_rapidas', {
  id: serial('id').primaryKey(),
  titulo: text('titulo').notNull(),
  cuerpo: text('cuerpo').notNull(),
  creadoAt: fecha('creado_at').notNull().defaultNow(),
});

export type UsuarioFila = typeof usuarios.$inferSelect;
export type CategoriaFila = typeof categorias.$inferSelect;
export type TicketFila = typeof tickets.$inferSelect;
export type OutboxFila = typeof outboxEventos.$inferSelect;
export type SesionFila = typeof sesiones.$inferSelect;
export type RecuperacionFila = typeof recuperacionesPassword.$inferSelect;
