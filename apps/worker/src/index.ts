import { cargarConfig, cargarDotenv } from '@eco/api/config';
import { conectar } from '@eco/api/db';
import { crearLog } from '@eco/api/log';
import { esperarEsquema, iniciarWorker, type Worker } from './worker';

cargarDotenv();
const config = cargarConfig();
const log = crearLog('worker', config.LOG_LEVEL);
const conexion = conectar(config.DATABASE_URL, 8);
const apagado = new AbortController();
let worker: Worker | undefined;
/** Mantiene vivo el proceso mientras espera la base. */
const latido = setInterval(() => {}, 60_000);

async function apagar(codigo = 0) {
  if (apagado.signal.aborted) return;
  apagado.abort();
  log.info('Apagando el worker');
  setTimeout(() => process.exit(codigo), 15_000).unref();
  await arranque.catch(() => {});
  await worker?.detener().catch((err: Error) => log.error({ err }, 'Error al detener'));
  clearInterval(latido);
  await conexion.cerrar().catch(() => {});
  process.exit(codigo);
}
const arranque = (async () => {
  if (!(await esperarEsquema(conexion, log, apagado.signal))) return;
  worker = await iniciarWorker({ config, conexion, log });
  log.info('Worker en marcha');
})();
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => void apagar());
arranque.catch((err: Error) => {
  log.error({ err }, 'No se pudo iniciar el worker');
  void apagar(1);
});
