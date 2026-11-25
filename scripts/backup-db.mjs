// `npm run backup-db`: copia de seguridad en ./backups (formato "custom" de pg_dump, comprimido).
//
//   npm run backup-db                         elige solo: DATABASE_URL → Postgres embebido → Docker Compose
//   npm run backup-db -- --compose            base (y adjuntos) del despliegue con Docker Compose
//   npm run backup-db -- --url=postgres://…   un Postgres cualquiera, con el pg_dump instalado
//   npm run backup-db -- --embebido           el Postgres embebido de desarrollo
//   npm run backup-db -- --sin-adjuntos       (compose) solo la base
//
// La restauración se explica en docs/OPERACION.md.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { cargarEnv, RAIZ } from './comun.mjs';
import { desactivarGanchosDeSalida, dirDatos, iniciarPostgres } from './postgres.mjs';

const USO = 'Uso: node scripts/backup-db.mjs [--compose | --url[=postgres://…] | --embebido] [--sin-adjuntos]';

cargarEnv();
desactivarGanchosDeSalida();

// `--url` admite valor opcional (sin valor usa DATABASE_URL).
const argumentos = process.argv.slice(2).map((a) => (a === '--url' ? '--url=' : a));
let opciones;
try {
  opciones = parseArgs({
    args: argumentos,
    options: {
      compose: { type: 'boolean' },
      embebido: { type: 'boolean' },
      url: { type: 'string' },
      'sin-adjuntos': { type: 'boolean' },
      ayuda: { type: 'boolean' },
    },
  }).values;
} catch (e) {
  console.error(`${e.message}\n${USO}`);
  process.exit(1);
}
if (opciones.ayuda) {
  console.log(USO);
  process.exit(0);
}

const modo = opciones.compose
  ? 'compose'
  : opciones.embebido
    ? 'embebido'
    : opciones.url !== undefined || process.env.DATABASE_URL
      ? 'url'
      : existsSync(path.join(dirDatos(), 'PG_VERSION'))
        ? 'embebido'
        : 'compose';

const carpeta = path.join(RAIZ, 'backups');
const ahora = new Date();
const dos = (n) => String(n).padStart(2, '0');
const sello = `${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}-${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}`;

/**
 * Ejecuta un programa enviando su salida a un archivo de ./backups (sin redirecciones de shell).
 * El archivo solo queda con su nombre definitivo si el programa terminó bien.
 */
async function volcar(nombre, programa, args, env = process.env) {
  mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, nombre);
  const parcial = `${destino}.parcial`;
  const salida = createWriteStream(parcial, { mode: 0o600 });
  try {
    await new Promise((ok, mal) => {
      const hijo = spawn(programa, args, { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'inherit'] });
      let codigo = null;
      let escrito = false;
      const terminar = () => {
        if (codigo === null || !escrito) return;
        if (codigo === 0) ok();
        else mal(new Error(`${path.basename(programa)} terminó con código ${codigo}`));
      };
      hijo.on('error', (e) =>
        mal(e.code === 'ENOENT' ? new Error(`No se encontró el programa "${programa}".`) : e),
      );
      hijo.on('close', (c) => {
        codigo = c ?? 1;
        terminar();
      });
      salida.on('error', (e) => {
        hijo.kill();
        mal(e);
      });
      salida.on('finish', () => {
        escrito = true;
        terminar();
      });
      hijo.stdout.pipe(salida);
    });
    if (statSync(parcial).size === 0) throw new Error('La copia quedó vacía');
    renameSync(parcial, destino);
  } catch (e) {
    salida.destroy();
    rmSync(parcial, { force: true });
    throw e;
  }
  console.log(`Copia creada: ${path.relative(RAIZ, destino)} (${(statSync(destino).size / 1024).toFixed(0)} KB)`);
}

/** pg_dump: el indicado en PG_DUMP, el que traiga el paquete embebido o el del sistema (PATH). */
async function buscarPgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  try {
    const so = process.platform === 'win32' ? 'windows' : process.platform;
    // El paquete de la plataforma depende de `embedded-postgres`: se resuelve desde él.
    const requerir = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
    const { pg_ctl } = await import(pathToFileURL(requerir.resolve(`@embedded-postgres/${so}-${process.arch}`)).href);
    const incluido = path.join(path.dirname(pg_ctl), process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    if (existsSync(incluido)) return incluido;
  } catch {
    // Sin paquete embebido (instalación de producción): se usa el del sistema.
  }
  return 'pg_dump';
}

async function volcarUrl(url) {
  // La contraseña viaja por el entorno para que no quede visible en la lista de procesos.
  const sinClave = new URL(url);
  const env = { ...process.env };
  if (sinClave.password) env.PGPASSWORD = decodeURIComponent(sinClave.password);
  sinClave.password = '';
  const base = decodeURIComponent(sinClave.pathname.slice(1)) || 'postgres';
  try {
    await volcar(`${base}-${sello}.dump`, await buscarPgDump(), ['--format=custom', `--dbname=${sinClave}`], env);
  } catch (e) {
    throw new Error(
      `${e.message}\nSe necesita pg_dump de PostgreSQL 16 o posterior (paquete cliente de PostgreSQL). ` +
        'Si no está en el PATH, indique su ruta en la variable PG_DUMP.',
      { cause: e },
    );
  }
}

try {
  if (modo === 'compose') {
    await volcar(`ecosoporte-${sello}.dump`, 'docker', [
      'compose', 'exec', '-T', 'db',
      'sh', '-c', 'exec pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    ]);
    if (!opciones['sin-adjuntos'])
      await volcar(`adjuntos-${sello}.tar.gz`, 'docker', [
        'compose', 'exec', '-T', 'api', 'tar', '-czf', '-', '-C', '/data/uploads', '.',
      ]);
  } else if (modo === 'url') {
    const url = opciones.url || process.env.DATABASE_URL;
    if (!url) throw new Error(`Indique la base con --url=… o DATABASE_URL.\n${USO}`);
    await volcarUrl(url);
  } else {
    if (!existsSync(path.join(dirDatos(), 'PG_VERSION')))
      throw new Error(`No hay un Postgres embebido en ${dirDatos()}. Ejecute antes \`npm run dev\`.`);
    const servidor = await iniciarPostgres();
    try {
      await volcarUrl(servidor.url);
    } finally {
      await servidor.detener();
    }
  }
} catch (e) {
  console.error(`No se pudo crear la copia de seguridad: ${e?.message ?? e}`);
  process.exitCode = 1;
}
process.exit();
