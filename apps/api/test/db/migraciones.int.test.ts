import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, migrar, sembrar, usuarios } from '../../src/db';
import { crearBaseTemporal } from '../../../../tests/helpers/db';
import { montar, type Entorno } from './base';

describe('migraciones', () => {
  it('son idempotentes y seguras entre procesos concurrentes', async () => {
    const base = await crearBaseTemporal();
    try {
      await Promise.all([migrar(base.url), migrar(base.url), migrar(base.url)]);
      await migrar(base.url);
      const c = conectar(base.url, 2);
      const r = await c.db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      expect(r.rows[0]!.n).toBe(4);
      const ext = await c.db.execute(sql`select 1 from pg_extension where extname in ('pg_trgm', 'unaccent')`);
      expect(ext.rows).toHaveLength(2);
      for (const vista of [
        'v_tickets_metricas',
        'v_tablero_kpis',
        'v_tablero_semanal',
        'v_ranking_categorias',
        'v_ranking_areas',
        'v_carga_tecnicos',
        'v_mapa_calor',
      ])
        await c.db.execute(sql.raw(`select * from ${vista}`));
      await c.cerrar();
    } finally {
      await base.destruir();
    }
  });

  it('el seed base crea el administrador sin datos de demostración y no se repite', async () => {
    const base = await crearBaseTemporal();
    try {
      await migrar(base.url);
      const c = conectar(base.url, 3);
      const config = { seedDemo: false, ADMIN_EMAIL: 'Jefe@Ecologia.misiones.gob.ar', ADMIN_PASSWORD: 'una-clave-larga-1' };
      const [a, b] = await Promise.all([sembrar(c.db, config), sembrar(c.db, config)]);
      expect(a.usuariosCreados + b.usuariosCreados).toBe(1);
      const us = await c.db.select().from(usuarios);
      expect(us).toHaveLength(1);
      expect(us[0]).toMatchObject({ email: 'jefe@ecologia.misiones.gob.ar', rol: 'admin' });
      expect(us[0]!.passwordHash).toMatch(/^\$argon2id\$/);
      const r = await c.db.execute<{ a: number; c: number; t: number; m: number }>(sql`
        select (select count(*) from areas)::int a, (select count(*) from categorias)::int c,
               (select count(*) from tickets)::int t,
               (select count(*) from categorias where modo_asignacion <> 'manual')::int m`);
      expect(r.rows[0]).toEqual({ a: 8, c: 12, t: 0, m: 0 });
      const sinAdmin = await sembrar(c.db, { seedDemo: false, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' });
      expect(sinAdmin.avisos).toHaveLength(0);
      await expect(sembrar(c.db, { ...config, ADMIN_PASSWORD: 'corta' })).rejects.toThrow('10 caracteres');
      await c.cerrar();
    } finally {
      await base.destruir();
    }
  });
});

describe('código anual y restricciones', () => {
  let e: Entorno;
  beforeAll(async () => (e = await montar()));
  afterAll(() => e.desmontar());

  it('numera sin huecos ni repetidos bajo concurrencia', async () => {
    const s = await e.usuario('solicitante');
    const ids = await Promise.all(Array.from({ length: 40 }, () => e.pedido(s.id)));
    const codigos = (await Promise.all(ids.map(async (id) => (await e.fila(id)).codigo))).sort();
    expect(codigos).toEqual(Array.from({ length: 40 }, (_, i) => `TCK-2026-${String(i + 1).padStart(6, '0')}`));
  });

  it('usa el año de la hora argentina y reinicia cada año', async () => {
    const s = await e.usuario('solicitante');
    // 01/01/2027 02:30 UTC todavía es 31/12/2026 en Argentina.
    const viejo = await e.pedido(s.id, new Date('2027-01-01T02:30:00Z'));
    const nuevo = await e.pedido(s.id, new Date('2027-01-01T03:30:00Z'));
    expect((await e.fila(viejo)).codigo).toBe('TCK-2026-000041');
    expect((await e.fila(nuevo)).codigo).toBe('TCK-2027-000001');
  });

  it('el historial no se puede modificar y el email es único sin distinguir mayúsculas', async () => {
    await expect(e.db.execute(sql`update ticket_eventos set a = 'x'`)).rejects.toThrow();
    await expect(
      e.db.insert(usuarios).values({ email: 'SOLICITANTE@ecologia.misiones.gob.ar', nombre: 'Otro' }),
    ).rejects.toThrow();
  });
});
