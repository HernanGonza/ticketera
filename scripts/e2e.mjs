// `npm run e2e [-- <argumentos de playwright>]`: pruebas E2E sobre un stack aislado y recién creado
// (datos en .data-e2e, Postgres 5435, API 3101, web 5174). No toca el entorno de desarrollo.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ENTORNO_E2E } from '../tests/e2e/entorno.mjs';
import { RAIZ } from './comun.mjs';

const entorno = { ...process.env, ...ENTORNO_E2E };
const cliPlaywright = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')),
  'cli.js',
);

/** Ejecuta un script de Node y devuelve su código de salida. */
function node(args) {
  const hijo = spawn(process.execPath, args, { cwd: RAIZ, stdio: 'inherit', env: entorno });
  return new Promise((ok, mal) => {
    hijo.on('error', mal);
    hijo.on('exit', (codigo) => ok(codigo ?? 1));
  });
}

const ocupadoEn = (port, host) =>
  new Promise((ok) => {
    const s = connect({ port, host });
    const fin = (r) => {
      s.destroy();
      ok(r);
    };
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
    s.setTimeout(1000, () => fin(false));
  });
const ocupado = async (port) => (await ocupadoEn(port, '127.0.0.1')) || (await ocupadoEn(port, '::1'));

// Ctrl+C llega también a Playwright: se espera a que apague el stack antes de salir.
for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(senal, () => {});

const datos = path.join(RAIZ, ENTORNO_E2E.DATA_DIR);
// Si una corrida anterior dejó su Postgres vivo, se apaga antes de borrar los datos.
if (existsSync(path.join(datos, 'pg', 'postmaster.pid'))) await node(['scripts/postgres.mjs', 'stop']);

for (const nombre of ['PG_PORT', 'API_PORT', 'WEB_PORT']) {
  if (await ocupado(Number(ENTORNO_E2E[nombre]))) {
    console.error(`El puerto ${ENTORNO_E2E[nombre]} (${nombre} de E2E) está ocupado. Cierre ese proceso y reintente.`);
    process.exit(1);
  }
}
rmSync(datos, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

if (!existsSync(chromium.executablePath())) {
  console.log('Descargando Chromium para Playwright…');
  const codigo = await node([cliPlaywright, 'install', 'chromium']);
  if (codigo !== 0) {
    console.error('No se pudo instalar Chromium. En Linux puede requerir `npx playwright install-deps chromium`.');
    process.exit(codigo);
  }
}

process.exit(await node([cliPlaywright, 'test', ...process.argv.slice(2)]));
