/**
 * Lecturas que devuelven exactamente los DTO de `@eco/shared/schemas` (fechas ISO).
 * La autorización la decide quien llama (`accesoTicket` + `puedeVerTicket`), salvo en `listarTickets`.
 */
import { and, asc, count, desc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import {
  COLUMNAS_KANBAN,
  DIAS_CERRADOS_KANBAN,
  ESTADOS_ABIERTOS,
  esStaff,
  ETIQUETA_ESTADO,
  ETIQUETA_PRIORIDAD,
  type Estado,
  type Prioridad,
  type UsuarioSesion,
} from '@eco/shared/dominio';
import type {
  Adjunto,
  Area,
  Catalogo,
  Categoria,
  Configuracion,
  Mensaje,
  Notificacion,
  NoLeidos,
  Persona,
  RespuestaRapida,
  TicketDetalle,
  TicketEvento,
  TicketResumen,
  Usuario,
  UsuarioActual,
  zFiltroTickets,
  zFiltroUsuarios,
} from '@eco/shared/schemas';
import type { Ejecutor } from './conexion';
import { leerConfiguracion } from './configuracion';
import {
  adjuntos,
  areas,
  categorias,
  mensajes,
  notificaciones,
  respuestasRapidas,
  ticketEventos,
  tickets,
  usuarios,
} from './schema';

const iso = (d: Date) => d.toISOString();
const isoN = (d: Date | null) => (d ? d.toISOString() : null);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_CODIGO = /^TCK-\d{4}-\d{6,9}$/i;
export const esUuid = (v: unknown): v is string => typeof v === 'string' && RE_UUID.test(v);

/** Primeras palabras de un mensaje markdown, en texto plano. */
export function extracto(markdown: string, largo = 140): string {
  const plano = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/(\*\*|__|\*|`|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plano.length > largo ? `${plano.slice(0, largo - 1).trimEnd()}…` : plano;
}

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

const uSolicitante = alias(usuarios, 'u_solicitante');
const uAsignado = alias(usuarios, 'u_asignado');
const uUltimo = alias(usuarios, 'u_ultimo');

function consultaResumen(db: Ejecutor) {
  const ultimo = db
    .select({
      autorNombre: sql<string>`${uUltimo.nombre}`.as('um_autor'),
      cuerpo: sql<string>`left(${mensajes.cuerpo}, 600)`.as('um_cuerpo'),
      creadoAt: sql`${mensajes.creadoAt}`.mapWith(mensajes.creadoAt).as('um_creado_at'),
    })
    .from(mensajes)
    .innerJoin(uUltimo, eq(uUltimo.id, mensajes.autorId))
    .where(and(eq(mensajes.ticketId, tickets.id), sql`not ${mensajes.interno}`))
    .orderBy(desc(mensajes.creadoAt))
    .limit(1)
    .as('ultimo');

  return db
    .select({
      t: {
        id: tickets.id,
        codigo: tickets.codigo,
        titulo: tickets.titulo,
        estado: tickets.estado,
        prioridad: tickets.prioridad,
        categoriaId: tickets.categoriaId,
        areaId: tickets.areaId,
        solicitanteId: tickets.solicitanteId,
        asignadoId: tickets.asignadoId,
        ordenKanban: tickets.ordenKanban,
        creadoAt: tickets.creadoAt,
        actualizadoAt: tickets.actualizadoAt,
        primeraRespuestaAt: tickets.primeraRespuestaAt,
        resueltoAt: tickets.resueltoAt,
        venceRespuestaAt: tickets.venceRespuestaAt,
        venceResolucionAt: tickets.venceResolucionAt,
        slaRespuestaMin: tickets.slaRespuestaMin,
        slaResolucionMin: tickets.slaResolucionMin,
        enEsperaDesde: tickets.enEsperaDesde,
        version: tickets.version,
      },
      categoriaNombre: categorias.nombre,
      categoriaIcono: categorias.icono,
      areaNombre: areas.nombre,
      solicitanteNombre: uSolicitante.nombre,
      asignadoNombre: uAsignado.nombre,
      umAutor: ultimo.autorNombre,
      umCuerpo: ultimo.cuerpo,
      umCreadoAt: ultimo.creadoAt,
    })
    .from(tickets)
    .innerJoin(categorias, eq(categorias.id, tickets.categoriaId))
    .innerJoin(uSolicitante, eq(uSolicitante.id, tickets.solicitanteId))
    .leftJoin(areas, eq(areas.id, tickets.areaId))
    .leftJoin(uAsignado, eq(uAsignado.id, tickets.asignadoId))
    .leftJoinLateral(ultimo, sql`true`)
    .$dynamic();
}

type FilaResumen = Awaited<ReturnType<typeof consultaResumen>>[number];

function aResumen(f: FilaResumen): TicketResumen {
  const t = f.t;
  return {
    id: t.id,
    codigo: t.codigo,
    titulo: t.titulo,
    estado: t.estado,
    prioridad: t.prioridad,
    categoriaId: t.categoriaId,
    categoriaNombre: f.categoriaNombre,
    categoriaIcono: f.categoriaIcono,
    areaId: t.areaId,
    areaNombre: f.areaNombre,
    solicitante: { id: t.solicitanteId, nombre: f.solicitanteNombre },
    asignado: t.asignadoId ? { id: t.asignadoId, nombre: f.asignadoNombre ?? '' } : null,
    ordenKanban: t.ordenKanban,
    creadoAt: iso(t.creadoAt),
    actualizadoAt: iso(t.actualizadoAt),
    primeraRespuestaAt: isoN(t.primeraRespuestaAt),
    resueltoAt: isoN(t.resueltoAt),
    venceRespuestaAt: isoN(t.venceRespuestaAt),
    venceResolucionAt: isoN(t.venceResolucionAt),
    slaRespuestaMin: t.slaRespuestaMin,
    slaResolucionMin: t.slaResolucionMin,
    enEsperaDesde: isoN(t.enEsperaDesde),
    ultimoMensaje: f.umCreadoAt
      ? { autorNombre: f.umAutor ?? '', extracto: extracto(f.umCuerpo ?? ''), creadoAt: iso(f.umCreadoAt) }
      : null,
    version: t.version,
  };
}

/** Respeta el orden de `ids`; los inexistentes se omiten. */
export async function obtenerTicketsResumen(db: Ejecutor, ids: readonly string[]): Promise<TicketResumen[]> {
  const validos = ids.filter(esUuid);
  if (!validos.length) return [];
  const filas = await consultaResumen(db).where(inArray(tickets.id, validos));
  const porId = new Map(filas.map((f) => [f.t.id, aResumen(f)]));
  return validos.flatMap((id) => porId.get(id.toLowerCase()) ?? []);
}

export async function obtenerTicketResumen(db: Ejecutor, id: string): Promise<TicketResumen | null> {
  const [r] = await obtenerTicketsResumen(db, [id]);
  return r ?? null;
}

export type FiltroTicketsParseado = z.output<typeof zFiltroTickets>;

const patron = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

function condicionesListado(
  f: FiltroTicketsParseado,
  u: Pick<UsuarioSesion, 'id' | 'rol' | 'areaId'>,
  config: Pick<Configuracion, 'solicitanteVeArea'>,
  ahora: Date,
): SQL | undefined {
  const c: (SQL | undefined)[] = [];
  const propios = eq(tickets.solicitanteId, u.id);
  const delArea = u.areaId === null ? sql`false` : eq(tickets.areaId, u.areaId);
  const staff = esStaff(u);
  const veArea = staff || config.solicitanteVeArea;

  if (f.ambito === 'mios') c.push(propios);
  else if (f.ambito === 'area') c.push(veArea ? delArea : and(delArea, propios));
  else if (!staff) c.push(veArea ? or(propios, delArea) : propios);

  if (f.estado?.length) c.push(inArray(tickets.estado, f.estado));
  if (f.prioridad?.length) c.push(inArray(tickets.prioridad, f.prioridad));
  if (f.areaId) c.push(eq(tickets.areaId, f.areaId));
  if (f.categoriaId) c.push(eq(tickets.categoriaId, f.categoriaId));
  if (f.asignadoId) c.push(eq(tickets.asignadoId, f.asignadoId));
  if (f.sinAsignar !== undefined)
    c.push(f.sinAsignar ? sql`${tickets.asignadoId} is null` : sql`${tickets.asignadoId} is not null`);
  if (f.vencidos !== undefined) {
    const vencido = sql`(${inArray(tickets.estado, [...ESTADOS_ABIERTOS])} and coalesce(${tickets.venceResolucionAt} < coalesce(${tickets.enEsperaDesde}, ${ahora.toISOString()}::timestamptz), false))`;
    c.push(f.vencidos ? vencido : sql`not ${vencido}`);
  }
  if (f.q) {
    const p = sql`eco_normalizar(${patron(f.q)})`;
    c.push(
      sql`(eco_normalizar(${tickets.codigo}) like ${p} or eco_normalizar(${tickets.titulo}) like ${p} or eco_normalizar(${tickets.descripcion}) like ${p})`,
    );
  }
  return and(...c);
}

/** Listado paginado con visibilidad según rol y ámbito (`mios` = pedidos propios). */
export async function listarTickets(
  db: Ejecutor,
  filtro: FiltroTicketsParseado,
  usuario: Pick<UsuarioSesion, 'id' | 'rol' | 'areaId'>,
  config: Pick<Configuracion, 'solicitanteVeArea'>,
  ahora: Date = new Date(),
): Promise<{ items: TicketResumen[]; total: number }> {
  const donde = condicionesListado(filtro, usuario, config, ahora);
  const columna = {
    creadoAt: tickets.creadoAt,
    actualizadoAt: tickets.actualizadoAt,
    codigo: tickets.codigo,
    prioridad: tickets.prioridad,
    estado: tickets.estado,
    venceResolucionAt: tickets.venceResolucionAt,
    titulo: sql`eco_normalizar(${tickets.titulo})`,
  }[filtro.orden];
  const sentido = filtro.dir === 'asc' ? sql`asc` : sql`desc`;
  const [filas, [total]] = await Promise.all([
    consultaResumen(db)
      .where(donde)
      .orderBy(sql`${columna} ${sentido} nulls last`, desc(tickets.creadoAt), asc(tickets.id))
      .limit(filtro.porPagina)
      .offset((filtro.pagina - 1) * filtro.porPagina),
    db.select({ n: count() }).from(tickets).where(donde),
  ]);
  return { items: filas.map(aResumen), total: total?.n ?? 0 };
}

/** Tarjetas del tablero ordenadas por columna y posición. `cerrado` muestra los últimos 7 días. */
export async function listarKanban(db: Ejecutor, ahora: Date = new Date()): Promise<TicketResumen[]> {
  const desde = new Date(ahora.getTime() - DIAS_CERRADOS_KANBAN * 86_400_000);
  const filas = await consultaResumen(db)
    .where(
      or(
        inArray(
          tickets.estado,
          COLUMNAS_KANBAN.filter((e) => e !== 'cerrado'),
        ),
        and(eq(tickets.estado, 'cerrado'), gte(tickets.cerradoAt, desde)),
      ),
    )
    .orderBy(asc(tickets.estado), asc(tickets.ordenKanban), desc(tickets.creadoAt), asc(tickets.id));
  return filas.map(aResumen);
}

/** Datos para autorizar. Acepta uuid o código; una entrada inválida devuelve null. */
export async function accesoTicket(
  db: Ejecutor,
  idOCodigo: string,
): Promise<{ id: string; solicitanteId: string; areaId: number | null } | null> {
  const donde = RE_UUID.test(idOCodigo)
    ? eq(tickets.id, idOCodigo)
    : RE_CODIGO.test(idOCodigo)
      ? eq(tickets.codigo, idOCodigo.toUpperCase())
      : null;
  if (!donde) return null;
  const [t] = await db
    .select({ id: tickets.id, solicitanteId: tickets.solicitanteId, areaId: tickets.areaId })
    .from(tickets)
    .where(donde);
  return t ?? null;
}

/** `id` debe ser el uuid (resolver códigos con `accesoTicket`). */
export async function obtenerTicketDetalle(
  db: Ejecutor,
  id: string,
  opciones: { incluirInternos: boolean },
): Promise<TicketDetalle | null> {
  if (!esUuid(id)) return null;
  const resumen = await obtenerTicketResumen(db, id);
  if (!resumen) return null;
  const [extra] = await db
    .select({
      descripcion: tickets.descripcion,
      ubicacion: tickets.ubicacion,
      datos: tickets.datos,
      solicitanteEmail: usuarios.email,
      cerradoAt: tickets.cerradoAt,
      minutosEnEspera: tickets.minutosEnEspera,
      reabierto: tickets.reabierto,
      calificacion: tickets.calificacion,
      comentarioCalificacion: tickets.comentarioCalificacion,
    })
    .from(tickets)
    .innerJoin(usuarios, eq(usuarios.id, tickets.solicitanteId))
    .where(eq(tickets.id, id));
  if (!extra) return null;
  const lista = await leerAdjuntos(
    db,
    and(eq(adjuntos.ticketId, id), opciones.incluirInternos ? undefined : sql`not ${adjuntos.interno}`),
  );
  return { ...resumen, ...extra, cerradoAt: isoN(extra.cerradoAt), adjuntos: lista };
}

// ---------------------------------------------------------------------------------------------
// Adjuntos y mensajes
// ---------------------------------------------------------------------------------------------

async function filasAdjuntos(db: Ejecutor, donde: SQL | undefined) {
  return db
    .select({ a: adjuntos, subidoNombre: usuarios.nombre })
    .from(adjuntos)
    .innerJoin(usuarios, eq(usuarios.id, adjuntos.subidoPorId))
    .where(donde)
    .orderBy(asc(adjuntos.creadoAt), asc(adjuntos.id));
}

function aAdjunto({ a, subidoNombre }: Awaited<ReturnType<typeof filasAdjuntos>>[number]): Adjunto {
  return {
    id: a.id,
    ticketId: a.ticketId,
    mensajeId: a.mensajeId,
    nombre: a.nombre,
    mime: a.mime,
    bytes: a.bytes,
    interno: a.interno,
    subidoPor: { id: a.subidoPorId, nombre: subidoNombre },
    creadoAt: iso(a.creadoAt),
  };
}

const leerAdjuntos = async (db: Ejecutor, donde: SQL | undefined) => (await filasAdjuntos(db, donde)).map(aAdjunto);

/** Incluye `ruta` (relativa a UPLOADS_DIR); no enviarla al cliente. Verificar `interno` y acceso al ticket. */
export async function obtenerAdjunto(db: Ejecutor, id: string): Promise<(Adjunto & { ruta: string }) | null> {
  if (!esUuid(id)) return null;
  const [f] = await filasAdjuntos(db, eq(adjuntos.id, id));
  return f ? { ...aAdjunto(f), ruta: f.a.ruta } : null;
}

async function leerMensajes(db: Ejecutor, donde: SQL | undefined): Promise<Mensaje[]> {
  const filas = await db
    .select({ m: mensajes, nombre: usuarios.nombre, rol: usuarios.rol })
    .from(mensajes)
    .innerJoin(usuarios, eq(usuarios.id, mensajes.autorId))
    .where(donde)
    .orderBy(asc(mensajes.creadoAt), asc(mensajes.id));
  if (!filas.length) return [];
  const porMensaje = new Map<string, Adjunto[]>();
  const lista = await leerAdjuntos(
    db,
    inArray(
      adjuntos.mensajeId,
      filas.map((f) => f.m.id),
    ),
  );
  for (const a of lista) {
    const grupo = porMensaje.get(a.mensajeId!);
    if (grupo) grupo.push(a);
    else porMensaje.set(a.mensajeId!, [a]);
  }
  return filas.map(({ m, nombre, rol }) => ({
    id: m.id,
    ticketId: m.ticketId,
    autor: { id: m.autorId, nombre, esStaff: rol !== 'solicitante' },
    cuerpo: m.cuerpo,
    interno: m.interno,
    clienteId: m.clienteId,
    creadoAt: iso(m.creadoAt),
    editadoAt: isoN(m.editadoAt),
    adjuntos: porMensaje.get(m.id) ?? [],
  }));
}

export async function listarMensajes(
  db: Ejecutor,
  ticketId: string,
  opciones: { incluirInternos: boolean },
): Promise<Mensaje[]> {
  if (!esUuid(ticketId)) return [];
  return leerMensajes(
    db,
    and(eq(mensajes.ticketId, ticketId), opciones.incluirInternos ? undefined : sql`not ${mensajes.interno}`),
  );
}

/** Devuelve también notas internas: quien llama verifica el acceso. */
export async function obtenerMensaje(db: Ejecutor, id: string): Promise<Mensaje | null> {
  if (!esUuid(id)) return null;
  const [m] = await leerMensajes(db, eq(mensajes.id, id));
  return m ?? null;
}

// ---------------------------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------------------------

export async function listarEventos(
  db: Ejecutor,
  ticketId: string,
  opciones: { incluirSla: boolean },
): Promise<TicketEvento[]> {
  if (!esUuid(ticketId)) return [];
  const filas = await db
    .select({ e: ticketEventos, usuarioNombre: usuarios.nombre })
    .from(ticketEventos)
    .leftJoin(usuarios, eq(usuarios.id, ticketEventos.usuarioId))
    .where(
      and(
        eq(ticketEventos.ticketId, ticketId),
        opciones.incluirSla ? undefined : sql`${ticketEventos.tipo} not like 'sla\\_%'`,
      ),
    )
    .orderBy(asc(ticketEventos.fecha), asc(ticketEventos.id));

  const idsUsuarios = new Set<string>();
  const idsCategorias = new Set<number>();
  for (const { e } of filas) {
    for (const v of [e.de, e.a]) {
      if (!v) continue;
      if (e.tipo === 'asignacion' && esUuid(v)) idsUsuarios.add(v);
      if (e.tipo === 'categoria') idsCategorias.add(Number(v));
    }
  }
  const nombres = new Map<string, string>();
  if (idsUsuarios.size) {
    const us = await db
      .select({ id: usuarios.id, nombre: usuarios.nombre })
      .from(usuarios)
      .where(inArray(usuarios.id, [...idsUsuarios]));
    for (const u of us) nombres.set(u.id, u.nombre);
  }
  if (idsCategorias.size) {
    const cs = await db
      .select({ id: categorias.id, nombre: categorias.nombre })
      .from(categorias)
      .where(inArray(categorias.id, [...idsCategorias]));
    for (const c of cs) nombres.set(String(c.id), c.nombre);
  }

  const texto = (tipo: TicketEvento['tipo'], v: string | null): string | null => {
    switch (tipo) {
      case 'asignacion':
        return v ? (nombres.get(v) ?? 'Usuario eliminado') : 'Sin asignar';
      case 'categoria':
        return v ? (nombres.get(v) ?? v) : null;
      case 'estado':
      case 'creado':
        return v ? (ETIQUETA_ESTADO[v as Estado] ?? v) : null;
      case 'reabierto':
        // `de` es el estado anterior y `a` el motivo escrito por quien reabre.
        return v ? (ETIQUETA_ESTADO[v as Estado] ?? v) : null;
      case 'prioridad':
        return v ? (ETIQUETA_PRIORIDAD[v as Prioridad] ?? v) : null;
      case 'calificacion':
        return v ? `${v} de 5` : null;
      case 'sla_por_vencer':
      case 'sla_vencido':
        return v === 'respuesta' ? 'Primera respuesta' : v === 'resolucion' ? 'Resolución' : v;
      default:
        return v;
    }
  };

  return filas.map(({ e, usuarioNombre }) => ({
    id: e.id,
    ticketId: e.ticketId,
    tipo: e.tipo,
    de: e.de,
    a: e.a,
    deTexto: texto(e.tipo, e.de),
    aTexto: texto(e.tipo, e.a),
    usuario: e.usuarioId ? { id: e.usuarioId, nombre: usuarioNombre ?? '' } : null,
    fecha: iso(e.fecha),
  }));
}

// ---------------------------------------------------------------------------------------------
// No leídos y notificaciones
// ---------------------------------------------------------------------------------------------

/** Staff: tickets propios, asignados o en los que escribió. Solicitante: los suyos, sin notas internas. */
export async function noLeidos(db: Ejecutor, usuario: Pick<UsuarioSesion, 'id' | 'rol'>): Promise<NoLeidos> {
  const id = usuario.id;
  const staff = esStaff(usuario);
  const propios = staff
    ? sql`select id from tickets where asignado_id = ${id}
          union select id from tickets where solicitante_id = ${id}
          union select ticket_id from mensajes where autor_id = ${id}`
    : sql`select id from tickets where solicitante_id = ${id}`;
  const r = await db.execute<{ ticket_id: string; total: number }>(sql`
    select m.ticket_id, count(*)::int as total
    from (${propios}) p(id)
    join mensajes m on m.ticket_id = p.id
    left join lecturas l on l.ticket_id = m.ticket_id and l.usuario_id = ${id}
    where m.autor_id <> ${id}
      and (l.ultimo_mensaje_at is null or m.creado_at > l.ultimo_mensaje_at)
      ${staff ? sql`` : sql`and not m.interno`}
    group by m.ticket_id`);
  const porTicket: Record<string, number> = {};
  let total = 0;
  for (const f of r.rows) {
    porTicket[f.ticket_id] = f.total;
    total += f.total;
  }
  return { total, porTicket };
}

export const aNotificacion = (n: typeof notificaciones.$inferSelect): Notificacion => ({
  id: n.id,
  tipo: n.tipo,
  payload: n.payload,
  leida: n.leida,
  creadaAt: iso(n.creadaAt),
});

export async function listarNotificaciones(
  db: Ejecutor,
  usuarioId: string,
  limite = 50,
): Promise<{ items: Notificacion[]; sinLeer: number }> {
  const [filas, [sinLeer]] = await Promise.all([
    db
      .select()
      .from(notificaciones)
      .where(eq(notificaciones.usuarioId, usuarioId))
      .orderBy(desc(notificaciones.id))
      .limit(limite),
    db
      .select({ n: count() })
      .from(notificaciones)
      .where(and(eq(notificaciones.usuarioId, usuarioId), sql`not ${notificaciones.leida}`)),
  ]);
  return { items: filas.map(aNotificacion), sinLeer: sinLeer?.n ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Catálogo y usuarios
// ---------------------------------------------------------------------------------------------

export function listarAreas(db: Ejecutor, opciones: { soloActivas?: boolean } = {}): Promise<Area[]> {
  return db
    .select()
    .from(areas)
    .where(opciones.soloActivas ? eq(areas.activo, true) : undefined)
    .orderBy(asc(areas.nombre));
}

export async function obtenerArea(db: Ejecutor, id: number): Promise<Area | null> {
  const [a] = await db.select().from(areas).where(eq(areas.id, id));
  return a ?? null;
}

export function listarCategorias(db: Ejecutor, opciones: { incluirInactivas?: boolean } = {}): Promise<Categoria[]> {
  return db
    .select()
    .from(categorias)
    .where(opciones.incluirInactivas ? undefined : eq(categorias.activa, true))
    .orderBy(asc(categorias.orden), asc(categorias.id));
}

export async function obtenerCategoria(db: Ejecutor, id: number): Promise<Categoria | null> {
  const [c] = await db.select().from(categorias).where(eq(categorias.id, id));
  return c ?? null;
}

/** Staff activo (técnicos y administradores). */
export function listarTecnicos(db: Ejecutor): Promise<Persona[]> {
  return db
    .select({ id: usuarios.id, nombre: usuarios.nombre })
    .from(usuarios)
    .where(and(eq(usuarios.activo, true), inArray(usuarios.rol, ['tecnico', 'admin'])))
    .orderBy(asc(usuarios.nombre));
}

export function listarRespuestasRapidas(db: Ejecutor): Promise<RespuestaRapida[]> {
  return db
    .select({ id: respuestasRapidas.id, titulo: respuestasRapidas.titulo, cuerpo: respuestasRapidas.cuerpo })
    .from(respuestasRapidas)
    .orderBy(asc(respuestasRapidas.titulo), asc(respuestasRapidas.id));
}

/** GET /api/catalogo: categorías inactivas solo para admin; técnicos y respuestas solo para staff. */
export async function obtenerCatalogo(db: Ejecutor, usuario: Pick<UsuarioSesion, 'rol'>): Promise<Catalogo> {
  const staff = esStaff(usuario);
  const [a, c, t, r, configuracion] = await Promise.all([
    listarAreas(db),
    listarCategorias(db, { incluirInactivas: usuario.rol === 'admin' }),
    staff ? listarTecnicos(db) : [],
    staff ? listarRespuestasRapidas(db) : [],
    leerConfiguracion(db),
  ]);
  return { areas: a, categorias: c, tecnicos: t, respuestasRapidas: r, configuracion };
}

const consultaUsuarios = (db: Ejecutor) =>
  db
    .select({ u: usuarios, areaNombre: areas.nombre })
    .from(usuarios)
    .leftJoin(areas, eq(areas.id, usuarios.areaId))
    .$dynamic();

const aUsuario = ({ u, areaNombre }: Awaited<ReturnType<typeof consultaUsuarios>>[number]): Usuario => ({
  id: u.id,
  email: u.email,
  nombre: u.nombre,
  rol: u.rol,
  areaId: u.areaId,
  areaNombre,
  activo: u.activo,
  tienePassword: u.passwordHash !== null,
  ultimoAcceso: isoN(u.ultimoAcceso),
});

export async function listarUsuarios(
  db: Ejecutor,
  filtro: z.output<typeof zFiltroUsuarios>,
): Promise<{ items: Usuario[]; total: number }> {
  const p = filtro.q ? sql`eco_normalizar(${patron(filtro.q)})` : null;
  const donde = and(
    filtro.rol ? eq(usuarios.rol, filtro.rol) : undefined,
    p ? sql`(eco_normalizar(${usuarios.nombre}) like ${p} or eco_normalizar(${usuarios.email}) like ${p})` : undefined,
  );
  const [filas, [total]] = await Promise.all([
    consultaUsuarios(db)
      .where(donde)
      .orderBy(asc(usuarios.nombre), asc(usuarios.id))
      .limit(filtro.porPagina)
      .offset((filtro.pagina - 1) * filtro.porPagina),
    db.select({ n: count() }).from(usuarios).where(donde),
  ]);
  return { items: filas.map(aUsuario), total: total?.n ?? 0 };
}

export async function obtenerUsuario(db: Ejecutor, id: string): Promise<Usuario | null> {
  if (!esUuid(id)) return null;
  const [f] = await consultaUsuarios(db).where(eq(usuarios.id, id));
  return f ? aUsuario(f) : null;
}

/** Fila completa (incluye `passwordHash`) buscando el email sin distinguir mayúsculas. */
export async function buscarUsuarioPorEmail(db: Ejecutor, email: string) {
  const [u] = await db
    .select()
    .from(usuarios)
    .where(sql`lower(${usuarios.email}) = ${email.trim().toLowerCase()}`);
  return u ?? null;
}

/** Datos de sesión de un usuario activo; null si no existe o está inactivo. */
export async function obtenerUsuarioSesion(db: Ejecutor, id: string): Promise<UsuarioActual | null> {
  if (!esUuid(id)) return null;
  const [f] = await consultaUsuarios(db).where(and(eq(usuarios.id, id), eq(usuarios.activo, true)));
  if (!f) return null;
  const { u, areaNombre } = f;
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, areaId: u.areaId, areaNombre };
}
