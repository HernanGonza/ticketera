import { crearApp } from './app';
import { cargarConfig, cargarDotenv } from './config';
import { conectar } from './db';
import { iniciarRealtime } from './realtime';

cargarDotenv();
const config = cargarConfig();
const conexion = conectar(config.DATABASE_URL);
const app = await crearApp({ config, conexion });
const realtime = await iniciarRealtime(app.server, { config, conexion });
await app.listen({ host: config.API_HOST, port: config.API_PORT });

let cerrando = false;
async function apagar() {
  if (cerrando) return;
  cerrando = true;
  setTimeout(() => process.exit(0), 5000).unref();
  await realtime.cerrar().catch(() => {});
  await app.close().catch(() => {});
  await conexion.cerrar().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
