// Secretos de la instalación: si `.env` no los define (o trae los de ejemplo), se generan una sola vez y
// se guardan en el volumen `secretos`, compartido por la API y el worker. Nunca se escriben en los registros.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const carpeta = path.join(process.env.DATA_DIR || '/data', 'secretos');
const deEjemplo = (v) => !v || /^(cambiar|dev-solo)/i.test(v);

/** Lee el archivo o lo crea (solo legible por su dueño). `wx` evita que dos procesos lo pisen. */
function persistente(nombre, generar) {
  const archivo = path.join(carpeta, nombre);
  mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(archivo, generar(), { flag: 'wx', mode: 0o600 });
    console.log(`Se generó ${archivo}.`);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  return readFileSync(archivo, 'utf8').trim();
}

export function completarSecretos() {
  for (const clave of ['SESSION_SECRET', 'ALTCHA_HMAC_KEY'])
    if (deEjemplo(process.env[clave]))
      process.env[clave] = persistente(clave.toLowerCase(), () => randomBytes(48).toString('base64url'));
}

/** Instalación real sin contraseña inicial: se genera para `ADMIN_EMAIL` y se deja en un archivo. */
export function completarAdmin() {
  const { SEED_DEMO, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (SEED_DEMO === 'true' || SEED_DEMO === '1' || !ADMIN_EMAIL || ADMIN_PASSWORD) return;
  process.env.ADMIN_PASSWORD = persistente('admin-inicial', () => randomBytes(18).toString('base64url'));
}
