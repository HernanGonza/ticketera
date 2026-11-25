/** Indicadores del tablero. Definiciones en cada bloque; las fechas se agrupan en hora argentina. */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { ESTADOS_ABIERTOS, estadoSla } from '@eco/shared/dominio';
import { ZONA_HORARIA } from '@eco/shared/marca';
import type { Estadisticas, FiltroEstadisticas } from '@eco/shared/schemas';
import type { Ejecutor } from './conexion';
import { leerConfiguracion } from './configuracion';
import { tickets } from './schema';

const DIA_MS = 86_400_000;
/** "aaaa-mm-dd" en hora argentina (UTC-3 fijo). */
export const fechaLocal = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
const sumarDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);

const num = (v: unknown, decimales = 1): number | null => {
  if (v === null || v === undefined) return null;
  const f = 10 ** decimales;
  return Math.round(Number(v) * f) / f;
};

/**
 * - `kpis`: foto actual (área y categoría). Vencidos / por vencer: SLA de resolución en horario hábil;
 *   los tickets en espera no cuentan como "por vencer".
 * - `tiempos`, `porCategoria`, `porArea`, `mapaCalor`: tickets **creados** en el rango.
 * - `semanal`: creados y resueltos dentro del rango; backlog al fin de cada semana (o ahora).
 * - `porTecnico`: carga actual; resueltos y calificación de lo resuelto en el rango.
 */
export async function obtenerEstadisticas(
  db: Ejecutor,
  filtro: FiltroEstadisticas = {},
  ahora: Date = new Date(),
): Promise<Estadisticas> {
  const hoy = fechaLocal(ahora);
  const hasta = filtro.hasta ?? hoy;
  let desde = filtro.desde ?? sumarDias(hasta, -89);
  if (desde > hasta) desde = hasta;
  // Rangos muy largos se recortan a 5 años.
  if (desde < sumarDias(hasta, -1830)) desde = sumarDias(hasta, -1830);

  const medianoche = (f: string) => sql`(${f}::date::timestamp at time zone ${sql.raw(`'${ZONA_HORARIA}'`)})`;
  const ini = medianoche(desde);
  const fin = medianoche(sumarDias(hasta, 1));
  const ahoraSql = sql`${ahora.toISOString()}::timestamptz`;
  const local = (col: SQL) => sql`(${col} at time zone ${sql.raw(`'${ZONA_HORARIA}'`)})`;

  /** Filtro de área y categoría sobre el alias `t`. */
  const donde = sql`${filtro.areaId ? sql`t.area_id = ${filtro.areaId}` : sql`true`} and ${
    filtro.categoriaId ? sql`t.categoria_id = ${filtro.categoriaId}` : sql`true`
  }`;
  const cohorte = sql`${donde} and t.creado_at >= ${ini} and t.creado_at < ${fin}`;
  const medidas = sql`
    count(*)::int as total,
    percentile_cont(0.5) within group (order by t.min_primera_respuesta) as mediana_respuesta,
    percentile_cont(0.5) within group (order by t.min_resolucion) as mediana_resolucion,
    100.0 * count(*) filter (where t.cumple_sla) / nullif(count(t.cumple_sla), 0) as cumplimiento`;

  type Medidas = {
    total: number;
    mediana_respuesta: number | null;
    mediana_resolucion: number | null;
    cumplimiento: string | null;
  };

  const [{ calendario }, abiertos, hoyQ, tiempos, porCategoria, porArea, semanal, porTecnico, calor] =
    await Promise.all([
      leerConfiguracion(db),
      db
        .select({
          estado: tickets.estado,
          asignadoId: tickets.asignadoId,
          creadoAt: tickets.creadoAt,
          venceAt: tickets.venceResolucionAt,
          totalMin: tickets.slaResolucionMin,
          enEsperaDesde: tickets.enEsperaDesde,
        })
        .from(tickets)
        .where(
          and(
            inArray(tickets.estado, [...ESTADOS_ABIERTOS]),
            filtro.areaId ? eq(tickets.areaId, filtro.areaId) : undefined,
            filtro.categoriaId ? eq(tickets.categoriaId, filtro.categoriaId) : undefined,
          ),
        ),
      db.execute<{ creados: number; resueltos: number }>(sql`
        select
          count(*) filter (where t.creado_at >= ${medianoche(hoy)} and t.creado_at < ${medianoche(sumarDias(hoy, 1))})::int as creados,
          count(*) filter (where t.resuelto_at >= ${medianoche(hoy)} and t.resuelto_at < ${medianoche(sumarDias(hoy, 1))})::int as resueltos
        from tickets t
        where ${donde} and (t.creado_at >= ${medianoche(hoy)} or t.resuelto_at >= ${medianoche(hoy)})`),
      db.execute<Medidas & { reabiertos: string | null; calificacion: string | null }>(sql`
        select ${medidas},
          100.0 * count(*) filter (where t.reabierto > 0)
            / nullif(count(*) filter (where t.reabierto > 0 or t.resuelto_at is not null), 0) as reabiertos,
          avg(t.calificacion) as calificacion
        from v_tickets_metricas t where ${cohorte}`),
      db.execute<Medidas & { id: number; nombre: string }>(sql`
        select t.categoria_id as id, t.categoria_nombre as nombre, ${medidas}
        from v_tickets_metricas t where ${cohorte}
        group by t.categoria_id, t.categoria_nombre
        order by total desc, nombre`),
      db.execute<{ id: number | null; nombre: string; total: number }>(sql`
        select t.area_id as id, t.area_nombre as nombre, count(*)::int as total
        from v_tickets_metricas t where ${cohorte}
        group by t.area_id, t.area_nombre
        order by total desc, nombre`),
      db.execute<{ semana: string; creados: number; resueltos: number; backlog: number }>(sql`
        with semanas as (
          select g::date as semana,
                 g at time zone ${sql.raw(`'${ZONA_HORARIA}'`)} as inicio,
                 (g + interval '7 days') at time zone ${sql.raw(`'${ZONA_HORARIA}'`)} as fin
          from generate_series(
            date_trunc('week', ${desde}::date::timestamp),
            date_trunc('week', ${hasta}::date::timestamp),
            interval '7 days') as g
        ),
        base as materialized (
          select t.creado_at, t.resuelto_at, t.estado, t.cerrado_at
          from tickets t
          where ${donde} and t.creado_at < ${fin}
        )
        select to_char(w.semana, 'YYYY-MM-DD') as semana,
          count(*) filter (where b.creado_at >= greatest(w.inicio, ${ini}) and b.creado_at < least(w.fin, ${fin}))::int as creados,
          count(*) filter (where b.resuelto_at >= greatest(w.inicio, ${ini}) and b.resuelto_at < least(w.fin, ${fin}))::int as resueltos,
          count(*) filter (where b.creado_at < least(w.fin, ${fin}, ${ahoraSql})
            and (b.resuelto_at is null or b.resuelto_at >= least(w.fin, ${fin}, ${ahoraSql}))
            and not (b.estado = 'cancelado' and b.cerrado_at < least(w.fin, ${fin}, ${ahoraSql})))::int as backlog
        from semanas w left join base b on b.creado_at < w.fin
        group by w.semana
        order by w.semana`),
      db.execute<{ id: string; nombre: string; carga: number; resueltos: number; calificacion: string | null }>(sql`
        select u.id, u.nombre,
          count(t.id) filter (where t.estado in ('nuevo','asignado','en_curso','en_espera'))::int as carga,
          count(t.id) filter (where t.resuelto_at >= ${ini} and t.resuelto_at < ${fin})::int as resueltos,
          avg(t.calificacion) filter (where t.resuelto_at >= ${ini} and t.resuelto_at < ${fin}) as calificacion
        from usuarios u
        left join tickets t on t.asignado_id = u.id and ${donde}
        where u.rol in ('tecnico','admin')
        group by u.id, u.nombre, u.rol, u.activo
        having (u.rol = 'tecnico' and u.activo)
          or count(t.id) filter (where t.estado in ('nuevo','asignado','en_curso','en_espera')
               or (t.resuelto_at >= ${ini} and t.resuelto_at < ${fin})) > 0
        order by resueltos desc, carga desc, u.nombre`),
      db.execute<{ dia: number; hora: number; total: number }>(sql`
        select extract(dow from ${local(sql`t.creado_at`)})::int as dia,
               extract(hour from ${local(sql`t.creado_at`)})::int as hora,
               count(*)::int as total
        from tickets t where ${cohorte}
        group by 1, 2`),
    ]);

  const kpis = { abiertos: 0, sinAsignar: 0, vencidos: 0, porVencer: 0, creadosHoy: 0, resueltosHoy: 0 };
  for (const t of abiertos) {
    kpis.abiertos++;
    if (!t.asignadoId) kpis.sinAsignar++;
    const { semaforo } = estadoSla({ ...t, cumplidoAt: null }, ahora, calendario);
    if (semaforo === 'vencido') kpis.vencidos++;
    else if (semaforo === 'por_vencer') kpis.porVencer++;
  }
  kpis.creadosHoy = hoyQ.rows[0]?.creados ?? 0;
  kpis.resueltosHoy = hoyQ.rows[0]?.resueltos ?? 0;

  const m = tiempos.rows[0];
  const celdas = new Map(calor.rows.map((c) => [c.dia * 24 + c.hora, c.total]));
  return {
    rango: { desde, hasta },
    kpis,
    tiempos: {
      medianaRespuestaMin: num(m?.mediana_respuesta),
      medianaResolucionMin: num(m?.mediana_resolucion),
      cumplimientoSlaPct: num(m?.cumplimiento),
      tasaReabiertosPct: num(m?.reabiertos),
      calificacionPromedio: num(m?.calificacion, 2),
    },
    porCategoria: porCategoria.rows.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      total: f.total,
      medianaRespuestaMin: num(f.mediana_respuesta),
      medianaResolucionMin: num(f.mediana_resolucion),
      cumplimientoSlaPct: num(f.cumplimiento),
    })),
    porArea: porArea.rows.map((f) => ({ id: f.id, nombre: f.nombre, total: f.total })),
    semanal: semanal.rows.map((f) => ({
      semana: f.semana,
      creados: f.creados,
      resueltos: f.resueltos,
      backlog: f.backlog,
    })),
    porTecnico: porTecnico.rows.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      carga: f.carga,
      resueltos: f.resueltos,
      calificacionPromedio: num(f.calificacion, 2),
    })),
    /** 7 × 24 celdas, incluidas las vacías. */
    mapaCalor: Array.from({ length: 168 }, (_, i) => ({
      dia: Math.floor(i / 24),
      hora: i % 24,
      total: celdas.get(i) ?? 0,
    })),
  };
}
