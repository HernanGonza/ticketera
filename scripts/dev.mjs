// `npm run dev`: Postgres (embebido o DATABASE_URL) + migraciones + seed + API + worker + web.
import concurrently from 'concurrently';
import { cargarEnv, npm, RAIZ } from './comun.mjs';
import { iniciarPostgres } from './postgres.mjs';

cargarEnv();
let pg = null;
if (!process.env.DATABASE_URL) {
  console.log('Iniciando Postgres embebido…');
  pg = await iniciarPostgres();
  process.env.DATABASE_URL = pg.url;
}
try {
  await npm(['run', 'db:migrate', '-w', '@eco/api']);
  await npm(['run', 'db:seed', '-w', '@eco/api']);
  const { result } = concurrently(
    [
      { command: 'npm run dev:api', name: 'api', prefixColor: 'green' },
      { command: 'npm run dev:worker', name: 'worker', prefixColor: 'magenta' },
      { command: 'npm run dev:web', name: 'web', prefixColor: 'yellow' },
    ],
    { cwd: RAIZ, killOthersOn: ['failure'], prefix: 'name' },
  );
  await result;
} catch (e) {
  if (e instanceof Error) console.error(e.message);
  process.exitCode = 1;
} finally {
  await pg?.detener().catch(() => {});
  process.exit();
}
