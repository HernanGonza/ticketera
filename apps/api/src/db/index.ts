/** Esqueleto de Fase 1. El agente db completa esquema, migraciones y consultas manteniendo estas firmas. */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export function conectar(url: string, max = 10) {
  const pool = new pg.Pool({ connectionString: url, max });
  pool.on('error', () => {});
  const db = drizzle(pool);
  return {
    pool,
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    cerrar: () => pool.end(),
  };
}
export type Conexion = ReturnType<typeof conectar>;
export type Db = Conexion['db'];
