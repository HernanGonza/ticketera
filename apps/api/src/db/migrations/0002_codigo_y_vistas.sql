-- Código anual correlativo TCK-AAAA-000001 (año según hora de Argentina).
-- El upsert bloquea la fila del año: numeración sin huecos aun con altas concurrentes.
CREATE OR REPLACE FUNCTION public.eco_asignar_codigo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_anio integer;
  v_numero integer;
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    v_anio := extract(year FROM NEW.creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires');
    INSERT INTO contadores_codigo AS c (anio, ultimo) VALUES (v_anio, 1)
      ON CONFLICT (anio) DO UPDATE SET ultimo = c.ultimo + 1
      RETURNING c.ultimo INTO v_numero;
    NEW.codigo := 'TCK-' || v_anio || '-' || lpad(v_numero::text, greatest(6, length(v_numero::text)), '0');
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tickets_codigo BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.eco_asignar_codigo();
--> statement-breakpoint
-- El historial es inmutable.
CREATE OR REPLACE FUNCTION public.eco_historial_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ticket_eventos es un historial inmutable';
END
$$;
--> statement-breakpoint
CREATE TRIGGER ticket_eventos_inmutable BEFORE UPDATE ON ticket_eventos
  FOR EACH ROW EXECUTE FUNCTION public.eco_historial_inmutable();
--> statement-breakpoint
-- Una fila por ticket con sus métricas. Base del tablero y de Metabase.
CREATE VIEW v_tickets_metricas AS
SELECT
  t.id,
  t.codigo,
  t.titulo,
  t.estado,
  t.prioridad,
  t.categoria_id,
  c.nombre AS categoria_nombre,
  t.area_id,
  coalesce(a.nombre, 'Sin área') AS area_nombre,
  t.solicitante_id,
  s.nombre AS solicitante_nombre,
  t.asignado_id,
  u.nombre AS asignado_nombre,
  t.creado_at,
  t.creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires' AS creado_local,
  (t.creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS creado_fecha,
  extract(dow FROM t.creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS dia_semana,
  extract(hour FROM t.creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS hora,
  date_trunc('week', t.creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS semana_creacion,
  t.primera_respuesta_at,
  t.resuelto_at,
  (t.resuelto_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS resuelto_fecha,
  t.cerrado_at,
  t.vence_respuesta_at,
  t.vence_resolucion_at,
  t.sla_respuesta_min,
  t.sla_resolucion_min,
  t.minutos_en_espera,
  t.min_primera_respuesta,
  t.min_resolucion,
  t.reabierto,
  t.calificacion,
  t.estado IN ('nuevo', 'asignado', 'en_curso', 'en_espera') AS abierto,
  -- Sin mensaje de respuesta, la resolución cuenta como primera respuesta.
  coalesce(t.primera_respuesta_at, t.resuelto_at) <= t.vence_respuesta_at AS cumple_sla_respuesta,
  t.resuelto_at <= t.vence_resolucion_at AS cumple_sla_resolucion,
  -- Solo se evalúa en tickets resueltos (null mientras estén abiertos o si se cancelaron).
  CASE WHEN t.resuelto_at IS NOT NULL AND t.estado IN ('resuelto', 'cerrado') THEN
    coalesce(t.primera_respuesta_at, t.resuelto_at) <= t.vence_respuesta_at
      AND t.resuelto_at <= t.vence_resolucion_at
  END AS cumple_sla
FROM tickets t
JOIN categorias c ON c.id = t.categoria_id
JOIN usuarios s ON s.id = t.solicitante_id
LEFT JOIN areas a ON a.id = t.area_id
LEFT JOIN usuarios u ON u.id = t.asignado_id;
--> statement-breakpoint
-- Foto actual. "vencidos" compara contra el momento de la pausa si el ticket está en espera.
CREATE VIEW v_tablero_kpis AS
SELECT
  count(*) FILTER (WHERE estado IN ('nuevo', 'asignado', 'en_curso', 'en_espera'))::int AS abiertos,
  count(*) FILTER (WHERE estado IN ('nuevo', 'asignado', 'en_curso', 'en_espera') AND asignado_id IS NULL)::int AS sin_asignar,
  count(*) FILTER (WHERE estado IN ('nuevo', 'asignado', 'en_curso', 'en_espera')
    AND vence_resolucion_at < coalesce(en_espera_desde, now()))::int AS vencidos,
  count(*) FILTER (WHERE (creado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::int AS creados_hoy,
  count(*) FILTER (WHERE (resuelto_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::int AS resueltos_hoy
FROM tickets;
--> statement-breakpoint
-- Creados, resueltos y backlog (abiertos al fin de la semana) por semana que comienza el lunes.
CREATE VIEW v_tablero_semanal AS
WITH semanas AS (
  SELECT g::date AS semana,
         g AT TIME ZONE 'America/Argentina/Buenos_Aires' AS inicio,
         (g + interval '7 days') AT TIME ZONE 'America/Argentina/Buenos_Aires' AS fin
  FROM generate_series(
    (SELECT date_trunc('week', min(creado_at) AT TIME ZONE 'America/Argentina/Buenos_Aires') FROM tickets),
    date_trunc('week', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'),
    interval '7 days') AS g
)
SELECT
  w.semana,
  (SELECT count(*) FROM tickets t WHERE t.creado_at >= w.inicio AND t.creado_at < w.fin)::int AS creados,
  (SELECT count(*) FROM tickets t WHERE t.resuelto_at >= w.inicio AND t.resuelto_at < w.fin)::int AS resueltos,
  (SELECT count(*) FROM tickets t WHERE t.creado_at < w.fin
     AND (t.resuelto_at IS NULL OR t.resuelto_at >= w.fin)
     AND NOT (t.estado = 'cancelado' AND t.cerrado_at < w.fin))::int AS backlog
FROM semanas w;
--> statement-breakpoint
CREATE VIEW v_ranking_categorias AS
SELECT
  categoria_id,
  categoria_nombre,
  count(*)::int AS total,
  count(*) FILTER (WHERE abierto)::int AS abiertos,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY min_primera_respuesta) AS mediana_respuesta_min,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY min_resolucion) AS mediana_resolucion_min,
  round(100.0 * count(*) FILTER (WHERE cumple_sla) / nullif(count(cumple_sla), 0), 1) AS cumplimiento_sla_pct
FROM v_tickets_metricas
GROUP BY categoria_id, categoria_nombre;
--> statement-breakpoint
CREATE VIEW v_ranking_areas AS
SELECT
  area_id,
  area_nombre,
  count(*)::int AS total,
  count(*) FILTER (WHERE abierto)::int AS abiertos,
  round(100.0 * count(*) FILTER (WHERE cumple_sla) / nullif(count(cumple_sla), 0), 1) AS cumplimiento_sla_pct
FROM v_tickets_metricas
GROUP BY area_id, area_nombre;
--> statement-breakpoint
CREATE VIEW v_carga_tecnicos AS
SELECT
  u.id AS tecnico_id,
  u.nombre,
  count(t.id) FILTER (WHERE t.estado IN ('nuevo', 'asignado', 'en_curso', 'en_espera'))::int AS carga,
  count(t.id) FILTER (WHERE t.resuelto_at IS NOT NULL)::int AS resueltos,
  round(avg(t.calificacion), 2) AS calificacion_promedio
FROM usuarios u
LEFT JOIN tickets t ON t.asignado_id = u.id
WHERE u.rol IN ('tecnico', 'admin') AND u.activo
GROUP BY u.id, u.nombre;
--> statement-breakpoint
CREATE VIEW v_mapa_calor AS
SELECT dia_semana, hora, count(*)::int AS total
FROM v_tickets_metricas
GROUP BY dia_semana, hora;
