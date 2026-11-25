/** `migrar` | `seed` | `reset` | `perf [n]` (agrega n pedidos abiertos). */
import { sql } from 'drizzle-orm';
import { cargarConfig, cargarDotenv } from '../config';
import { conectar } from './conexion';
import { migrar } from './migrar';
import { sembrar, sembrarTickets } from './seed';

async function principal(orden: string | undefined, argumento: string | undefined) {
  cargarDotenv();
  const config = cargarConfig();
  if (!['migrar', 'seed', 'reset', 'perf'].includes(orden ?? ''))
    throw new Error('Uso: cli.ts migrar|seed|reset|perf [cantidad]');
  if (config.produccion && (orden === 'reset' || orden === 'perf'))
    throw new Error(`«${orden}» no está permitido en producción.`);

  const conexion = conectar(config.DATABASE_URL, 2);
  try {
    if (orden === 'reset') {
      await conexion.db.transaction(async (tx) => {
        await tx.execute(sql`drop schema if exists drizzle cascade`);
        await tx.execute(sql`drop schema if exists pgboss cascade`);
        await tx.execute(sql`drop schema if exists public cascade`);
        await tx.execute(sql`create schema public`);
      });
      console.log('Base vaciada.');
    }
    if (orden === 'migrar' || orden === 'reset') {
      await migrar(config.DATABASE_URL);
      console.log('Migraciones aplicadas.');
    }
    if (orden === 'seed' || orden === 'reset') {
      const r = await sembrar(conexion.db, config);
      console.log(
        `Seed ${r.demo ? 'de demostración' : 'base'}: ${r.usuariosCreados} usuarios y ${r.ticketsCreados} pedidos nuevos.`,
      );
      for (const aviso of r.avisos) console.warn(aviso);
    }
    if (orden === 'perf') {
      const n = Number(argumento ?? 500);
      if (!Number.isInteger(n) || n < 1 || n > 20_000) throw new Error('Cantidad no válida.');
      await sembrarTickets(conexion.db, n);
      console.log(`${n} pedidos abiertos agregados.`);
    }
  } finally {
    await conexion.cerrar();
  }
}

principal(process.argv[2], process.argv[3]).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
