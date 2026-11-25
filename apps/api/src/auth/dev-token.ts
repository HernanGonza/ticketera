/** `npm run dev:token -- --email <correo> [--redirect /ruta]`: imprime la URL de ingreso por el portal. */
import { parseArgs } from 'node:util';
import { zEmail } from '@eco/shared/schemas';
import { cargarConfig, cargarDotenv } from '../config';
import { EMPLEADOS_DEMO } from '../db/seed/empleados';
import { urlPortalDev } from './dev';

async function principal() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, redirect: { type: 'string' } } });
  const email = zEmail.safeParse(values.email);
  if (!email.success) throw new Error('Uso: npm run dev:token -- --email <correo> [--redirect /ruta]');
  cargarDotenv();
  const nombre = EMPLEADOS_DEMO.find((e) => e.email === email.data)?.nombre;
  console.log(await urlPortalDev(cargarConfig(), email.data, { nombre, redirect: values.redirect }));
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
