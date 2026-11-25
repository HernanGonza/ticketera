// Ejecuta un script db:* de la API garantizando que haya Postgres.
import { cargarEnv, npm } from './comun.mjs';
import { desactivarGanchosDeSalida, iniciarPostgres } from './postgres.mjs';

cargarEnv();
desactivarGanchosDeSalida();
// Ante Ctrl+C se espera a que termine el script hijo (que recibe la señal) para apagar Postgres.
for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(senal, () => {});
const script = process.argv[2];
let pg = null;
if (!process.env.DATABASE_URL) {
  pg = await iniciarPostgres();
  process.env.DATABASE_URL = pg.url;
}
let codigo = 0;
try {
  await npm(['run', script, '-w', '@eco/api']);
} catch (e) {
  console.error(e.message);
  codigo = 1;
}
await pg?.detener();
process.exit(codigo);
