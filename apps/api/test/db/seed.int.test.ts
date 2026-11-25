import { sql } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esAbierto, minutosHabilesEntre, ESTADOS } from '@eco/shared/dominio';
import { zEstadisticas, zTicketEvento, zTicketResumen, zMensaje } from '@eco/shared/schemas';
import { ICONOS_CATEGORIA } from '@eco/shared/schemas';
import {
  buscarUsuarioPorEmail,
  categorias,
  CONTRASENA_DEMO,
  EMPLEADOS_DEMO,
  leerConfiguracion,
  listarEventos,
  listarKanban,
  listarMensajes,
  obtenerEstadisticas,
  revisarSla,
  sembrar,
  sembrarTickets,
  tickets,
} from '../../src/db';
import { CONFIG_DEMO, montar, type Entorno } from './base';

const AHORA = new Date('2026-11-24T14:00:00-03:00');
let e: Entorno;
beforeAll(async () => (e = await montar({ tickets: 300, ahora: AHORA })));
afterAll(() => e.desmontar());

const contar = async () =>
  (
    await e.db.execute(sql`
      select (select count(*) from usuarios)::int u, (select count(*) from areas)::int a,
        (select count(*) from categorias)::int c, (select count(*) from tickets)::int t,
        (select count(*) from ticket_eventos)::int ev, (select count(*) from mensajes)::int m,
        (select count(*) from respuestas_rapidas)::int r, (select count(*) from notificaciones)::int n`)
  ).rows[0]!;

/** Filas que incumplen un invariante. */
const incumplen = async (condicion: string) =>
  (await e.db.execute(sql.raw(condicion))).rows;

describe('seed de demostración', () => {
  it('carga las cantidades de la especificación y no duplica en la segunda corrida', async () => {
    const antes = await contar();
    expect(antes).toMatchObject({ u: 24, a: 8, c: 12, t: 300 });
    expect(await sembrar(e.db, CONFIG_DEMO)).toMatchObject({ usuariosCreados: 0, ticketsCreados: 0 });
    expect(await contar()).toEqual(antes);
    const cats = await e.db.select().from(categorias);
    for (const c of cats) expect(ICONOS_CATEGORIA).toContain(c.icono);
    expect(new Set(cats.map((c) => c.modoAsignacion)).size).toBe(3);
    expect(await e.db.execute(sql`select 1 from outbox_eventos`).then((r) => r.rowCount)).toBe(0);
  });

  it('las cuentas principales entran con la contraseña demo y los empleados coinciden', async () => {
    for (const rol of ['admin', 'tecnico', 'solicitante']) {
      const u = await buscarUsuarioPorEmail(e.db, `${rol.toUpperCase()}@ecologia.misiones.gob.ar`);
      expect(u?.rol).toBe(rol);
      expect(await verify(u!.passwordHash!, CONTRASENA_DEMO)).toBe(true);
    }
    const r = await e.db.execute<{ email: string; area_id: number }>(sql`select email, area_id from usuarios`);
    for (const u of r.rows) expect(EMPLEADOS_DEMO.find((x) => x.email === u.email)?.areaId).toBe(u.area_id);
    expect(EMPLEADOS_DEMO.length).toBe(r.rows.length + 3);
    expect(EMPLEADOS_DEMO.find((x) => x.email.startsWith('baja@'))?.activo).toBe(false);
  });

  it('es determinista', async () => {
    const otro = await montar({ tickets: 300, ahora: AHORA });
    const huella = (x: Entorno) =>
      x.db
        .execute(sql`select md5(string_agg(codigo || titulo || estado::text || creado_at::text, ',' order by codigo)) h from tickets`)
        .then((r) => r.rows[0]);
    expect(await huella(otro)).toEqual(await huella(e));
    await otro.desmontar();
  });

  it('estados, fechas, eventos, mensajes y métricas son coherentes', async () => {
    const porEstado = await e.db.execute<{ estado: string; n: number }>(
      sql`select estado, count(*)::int n from tickets group by estado`,
    );
    const n = Object.fromEntries(porEstado.rows.map((f) => [f.estado, f.n]));
    for (const estado of ESTADOS) expect(n[estado], estado).toBeGreaterThan(0);
    const abiertos = ESTADOS.filter(esAbierto).reduce((s, x) => s + n[x]!, 0);
    expect(abiertos).toBeGreaterThan(25);
    expect(abiertos).toBeLessThan(70);
    expect(n.cerrado).toBeGreaterThan(180);

    const reglas = [
      `select codigo from tickets where creado_at > '${AHORA.toISOString()}' or actualizado_at < creado_at or actualizado_at > '${AHORA.toISOString()}'`,
      `select codigo from tickets where (estado = 'nuevo') <> (asignado_id is null) and estado <> 'cancelado'`,
      `select codigo from tickets where (resuelto_at is not null) <> (estado in ('resuelto','cerrado'))`,
      `select codigo from tickets where (min_resolucion is not null) <> (resuelto_at is not null)`,
      `select codigo from tickets where (cerrado_at is not null) <> (estado in ('cerrado','cancelado'))`,
      `select codigo from tickets where (en_espera_desde is not null) <> (estado = 'en_espera')`,
      `select codigo from tickets where (autocierre_at is not null) <> (estado = 'resuelto')`,
      `select codigo from tickets where (primera_respuesta_at is null) <> (min_primera_respuesta is null)`,
      `select codigo from tickets where calificacion is not null and estado not in ('resuelto','cerrado')`,
      // El último evento de estado coincide con el estado actual.
      `select t.codigo from tickets t where t.estado <> coalesce((select e.a from ticket_eventos e
         where e.ticket_id = t.id and e.tipo in ('estado','creado') order by e.fecha desc, e.id desc limit 1), '')::estado_ticket`,
      // La primera respuesta es el primer mensaje público de staff.
      `select t.codigo from tickets t where t.primera_respuesta_at is distinct from (select min(m.creado_at) from mensajes m
         join usuarios u on u.id = m.autor_id where m.ticket_id = t.id and not m.interno and u.rol <> 'solicitante')`,
      `select t.codigo from tickets t where t.reabierto <> (select count(*) from ticket_eventos e where e.ticket_id = t.id and e.tipo = 'reabierto')`,
      `select codigo from tickets t where exists (select 1 from mensajes m where m.ticket_id = t.id and (m.creado_at < t.creado_at or m.creado_at > '${AHORA.toISOString()}'))`,
      // Códigos en orden cronológico.
      `select * from (select codigo, creado_at, lag(creado_at) over (order by codigo) previo from tickets) x where creado_at < previo`,
    ];
    for (const regla of reglas) expect(await incumplen(regla), regla).toEqual([]);

    const { calendario } = await leerConfiguracion(e.db);
    for (const t of await e.db.select().from(tickets)) {
      if (t.resueltoAt)
        expect(t.minResolucion).toBe(minutosHabilesEntre(t.creadoAt, t.resueltoAt, calendario) - t.minutosEnEspera);
    }
    // Las alertas ya figuran emitidas: el worker no avisa de golpe al arrancar.
    expect(await revisarSla(e.db, AHORA)).toEqual([]);
  });

  it('las consultas sobre los datos sembrados cumplen los contratos', async () => {
    const kanban = await listarKanban(e.db, AHORA);
    kanban.forEach((t) => zTicketResumen.parse(t));
    expect(kanban.some((t) => t.estado === 'cancelado')).toBe(false);
    expect(kanban.some((t) => t.estado === 'cerrado')).toBe(true);
    for (const t of kanban.filter((x) => x.estado === 'cerrado'))
      expect(Date.parse(t.resueltoAt!)).toBeGreaterThan(AHORA.getTime() - 20 * 86_400_000);
    for (const t of kanban.slice(0, 15)) {
      (await listarEventos(e.db, t.id, { incluirSla: true })).forEach((x) => zTicketEvento.parse(x));
      (await listarMensajes(e.db, t.id, { incluirInternos: true })).forEach((x) => zMensaje.parse(x));
    }
  });
});

describe('estadísticas', () => {
  it('calcula indicadores coherentes con los datos', async () => {
    const s = zEstadisticas.parse(await obtenerEstadisticas(e.db, {}, AHORA));
    expect(s.rango).toEqual({ desde: '2026-08-27', hasta: '2026-11-24' });
    const abiertos = (
      await e.db.execute<{ n: number; s: number }>(sql`
        select count(*)::int n, count(*) filter (where asignado_id is null)::int s from tickets
        where estado in ('nuevo','asignado','en_curso','en_espera')`)
    ).rows[0]!;
    expect(s.kpis).toMatchObject({ abiertos: abiertos.n, sinAsignar: abiertos.s });
    expect(s.kpis.vencidos).toBeGreaterThan(0);
    expect(s.kpis.porVencer).toBeGreaterThan(0);
    expect(s.tiempos.medianaRespuestaMin).toBeGreaterThan(0);
    expect(s.tiempos.medianaResolucionMin).toBeGreaterThan(s.tiempos.medianaRespuestaMin!);
    expect(s.tiempos.cumplimientoSlaPct).toBeGreaterThan(50);
    expect(s.tiempos.cumplimientoSlaPct).toBeLessThan(95);
    expect(s.tiempos.tasaReabiertosPct).toBeGreaterThan(0);
    expect(s.tiempos.calificacionPromedio).toBeGreaterThan(3);

    const total = s.porCategoria.reduce((a, c) => a + c.total, 0);
    expect(total).toBeGreaterThan(290);
    expect(s.porArea.reduce((a, c) => a + c.total, 0)).toBe(total);
    expect(s.mapaCalor).toHaveLength(168);
    expect(s.mapaCalor.reduce((a, c) => a + c.total, 0)).toBe(total);
    expect(s.semanal.reduce((a, c) => a + c.creados, 0)).toBe(total);
    for (const w of s.semanal) expect(new Date(`${w.semana}T12:00:00Z`).getUTCDay()).toBe(1);
    // El backlog al día de hoy son los abiertos.
    expect(s.semanal.at(-1)!.backlog).toBe(abiertos.n);
    expect(s.porTecnico.length).toBeGreaterThanOrEqual(3);
  });

  it('filtra por fecha, área y categoría, y admite rangos vacíos', async () => {
    const [c] = await e.db.select().from(categorias).limit(1);
    const f = await obtenerEstadisticas(
      e.db,
      { desde: '2026-10-01', hasta: '2026-10-31', areaId: 2, categoriaId: c!.id },
      AHORA,
    );
    zEstadisticas.parse(f);
    const r = await e.db.execute<{ n: number }>(sql`
      select count(*)::int n from tickets where area_id = 2 and categoria_id = ${c!.id}
        and creado_at >= '2026-10-01T00:00:00-03:00' and creado_at < '2026-11-01T00:00:00-03:00'`);
    expect(f.porCategoria.reduce((a, x) => a + x.total, 0)).toBe(r.rows[0]!.n);
    const vacio = zEstadisticas.parse(
      await obtenerEstadisticas(e.db, { desde: '2020-01-01', hasta: '2020-01-31' }, AHORA),
    );
    expect(vacio.tiempos.medianaRespuestaMin).toBeNull();
    expect(vacio.porCategoria).toEqual([]);
    expect(vacio.semanal.every((w) => w.creados === 0 && w.backlog === 0)).toBe(true);
  });
});

describe('rendimiento', () => {
  it('lista el kanban con más de 500 tarjetas en pocas decenas de ms', async () => {
    expect(await sembrarTickets(e.db, 500, { ahora: AHORA })).toBe(500);
    await e.db.execute(sql`analyze`);
    await listarKanban(e.db, AHORA);
    const tiempos: number[] = [];
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      total = (await listarKanban(e.db, AHORA)).length;
      tiempos.push(performance.now() - t0);
    }
    const t0 = performance.now();
    await obtenerEstadisticas(e.db, {}, AHORA);
    const estadisticas = performance.now() - t0;
    const mediana = tiempos.sort((a, b) => a - b)[3]!;
    console.log(`kanban ${total} tarjetas: ${mediana.toFixed(1)} ms; estadísticas: ${estadisticas.toFixed(1)} ms`);
    expect(total).toBeGreaterThanOrEqual(540);
    // Margen amplio para máquinas de integración cargadas.
    expect(mediana).toBeLessThan(250);
    const orden = await e.db.execute(
      sql`select estado, orden_kanban from tickets group by 1, 2 having count(*) > 1`,
    );
    expect(orden.rows).toEqual([]);
  });
});
