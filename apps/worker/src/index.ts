import { cargarConfig, cargarDotenv } from '@eco/api/config';
import { conectar } from '@eco/api/db';
import { crearLog } from '@eco/api/log';

cargarDotenv();
const config = cargarConfig();
const log = crearLog('worker');
const conexion = conectar(config.DATABASE_URL, 5);
await conexion.ping();
log.info('Worker conectado a la base de datos');
const latido = setInterval(() => {}, 60_000);
for (const s of ['SIGINT', 'SIGTERM'] as const)
  process.on(s, () => {
    clearInterval(latido);
    void conexion.cerrar().finally(() => process.exit(0));
  });
