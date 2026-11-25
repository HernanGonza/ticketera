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
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Conexión o transacción en curso: toda operación y consulta acepta ambas. */
export type Ejecutor = Db | Tx;
