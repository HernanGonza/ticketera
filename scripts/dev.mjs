// `npm run dev`: Postgres (embebido o DATABASE_URL) + migraciones + seed + API + worker + web.
// Apagado: ante SIGINT/SIGTERM/SIGHUP (Ctrl+C, Playwright, cierre de la consola) detiene primero los
// procesos hijos y después el Postgres embebido.
import concurrently from 'concurrently';
import { cargarEnv, npm, RAIZ } from './comun.mjs';
import { desactivarGanchosDeSalida, iniciarPostgres } from './postgres.mjs';

/** Margen para que los hijos cierren solos antes de forzarlos, y tope total del apagado. */
const GRACIA_MS = 8_000;
const TOPE_MS = 12_000;

cargarEnv();
desactivarGanchosDeSalida();

let pg = null;
let comandos = [];
let apagando = false;

function alRecibirSenal() {
  if (apagando) return;
  apagando = true;
  // concurrently reenvía la señal a cada árbol de procesos; acá solo se controla que no se cuelgue.
  setTimeout(() => {
    for (const c of comandos) c.kill('SIGKILL');
  }, GRACIA_MS).unref();
  setTimeout(async () => {
    await pg?.detener().catch(() => {});
    process.exit(1);
  }, TOPE_MS).unref();
}
for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(senal, alRecibirSenal);

const verificar = () => {
  if (apagando) throw new Error('Arranque interrumpido');
};

try {
  if (!process.env.DATABASE_URL) {
    console.log('Iniciando Postgres embebido…');
    pg = await iniciarPostgres();
    process.env.DATABASE_URL = pg.url;
  }
  verificar();
  await npm(['run', 'db:migrate', '-w', '@eco/api']);
  verificar();
  await npm(['run', 'db:seed', '-w', '@eco/api']);
  verificar();
  const ejecucion = concurrently(
    [
      { command: 'npm run dev:api', name: 'api', prefixColor: 'green' },
      { command: 'npm run dev:worker', name: 'worker', prefixColor: 'magenta' },
      { command: 'npm run dev:web', name: 'web', prefixColor: 'yellow' },
    ],
    { cwd: RAIZ, killOthersOn: ['failure'], killTimeout: GRACIA_MS, prefix: 'name' },
  );
  comandos = ejecucion.commands;
  await ejecucion.result;
} catch (e) {
  if (!apagando) {
    if (e instanceof Error) console.error(e.message);
    process.exitCode = 1;
  }
} finally {
  await pg?.detener().catch(() => {});
  process.exit();
}
