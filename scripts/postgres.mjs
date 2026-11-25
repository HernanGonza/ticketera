// Postgres embebido para desarrollo y tests. Uso: node scripts/postgres.mjs start|stop
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { cargarEnv, RAIZ } from './comun.mjs';

export const USUARIO = 'eco';
export const CLAVE = 'eco';
export const BASE = 'ecosoporte';
export const urlDe = (puerto, base = BASE) => `postgres://${USUARIO}:${CLAVE}@127.0.0.1:${puerto}/${base}`;
export const dirDatos = () => path.resolve(RAIZ, process.env.DATA_DIR || '.data', 'pg');
export const puerto = () => Number(process.env.PG_PORT || 5433);

async function consultar(url, texto, params) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  await c.connect();
  try {
    return await c.query(texto, params);
  } finally {
    await c.end();
  }
}

/** Inicia (o reutiliza) el Postgres embebido y garantiza la base. Devuelve { url, detener }. */
export async function iniciarPostgres({ dir = dirDatos(), port = puerto(), base = BASE } = {}) {
  const admin = urlDe(port, 'postgres');
  let propio = null;
  const activo = await consultar(admin, 'show data_directory').catch(() => null);
  if (activo) {
    if (path.resolve(activo.rows[0].data_directory) !== path.resolve(dir))
      throw new Error(`El puerto ${port} está ocupado por otro Postgres. Defina PG_PORT o DATABASE_URL.`);
  } else {
    mkdirSync(path.dirname(dir), { recursive: true });
    let salida = '';
    propio = new EmbeddedPostgres({
      databaseDir: dir,
      user: USUARIO,
      password: CLAVE,
      port,
      persistent: true,
      autoRehydrateSymlinks: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: (m) => (salida = (salida + m).slice(-4000)),
      onError: (m) => (salida = (salida + String(m)).slice(-4000)),
    });
    try {
      if (!existsSync(path.join(dir, 'PG_VERSION'))) await propio.initialise();
      await propio.start();
    } catch (e) {
      console.error(salida);
      throw e ?? new Error('No se pudo iniciar el Postgres embebido');
    }
  }
  const existe = await consultar(admin, 'select 1 from pg_database where datname = $1', [base]);
  if (!existe.rowCount) await consultar(admin, `create database "${base}"`);
  return { url: urlDe(port, base), detener: async () => propio && (await propio.stop()) };
}

async function pgCtl() {
  const so = process.platform === 'win32' ? 'windows' : process.platform;
  return (await import(`@embedded-postgres/${so}-${process.arch}`)).pg_ctl;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cargarEnv();
  const orden = process.argv[2];
  if (orden === 'start') {
    const { url } = await iniciarPostgres();
    console.log(`Postgres escuchando en ${url}\nCtrl+C para detener.`);
    setInterval(() => {}, 60_000);
  } else if (orden === 'stop') {
    if (!existsSync(path.join(dirDatos(), 'postmaster.pid'))) console.log('Postgres no está en ejecución.');
    else execFileSync(await pgCtl(), ['stop', '-D', dirDatos(), '-m', 'fast'], { stdio: 'inherit' });
    process.exit(0);
  } else {
    console.error('Uso: node scripts/postgres.mjs start|stop');
    process.exit(1);
  }
}
