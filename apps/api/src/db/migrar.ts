import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { RAIZ } from '../config';

/** Clave del advisory lock que serializa migraciones concurrentes (api y worker arrancando a la vez). */
const BLOQUEO_MIGRACION = 7_316_001;

export function carpetaMigraciones(): string {
  const candidatas = [
    process.env.MIGRATIONS_DIR,
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
    // Código empaquetado (dist/): las migraciones se leen del árbol de fuentes.
    path.join(RAIZ, 'apps', 'api', 'src', 'db', 'migrations'),
  ];
  const carpeta = candidatas.find((c) => c && existsSync(path.join(c, 'meta', '_journal.json')));
  if (!carpeta) throw new Error('No se encontraron las migraciones (defina MIGRATIONS_DIR)');
  return carpeta;
}

/** Aplica las migraciones pendientes. Idempotente y seguro entre procesos concurrentes. */
export async function migrar(url: string): Promise<void> {
  const cliente = new pg.Client({ connectionString: url });
  cliente.on('notice', () => {});
  await cliente.connect();
  try {
    await cliente.query('select pg_advisory_lock($1)', [BLOQUEO_MIGRACION]);
    await migrate(drizzle(cliente), { migrationsFolder: carpetaMigraciones() });
  } finally {
    // Cerrar la sesión libera el advisory lock.
    await cliente.end();
  }
}
