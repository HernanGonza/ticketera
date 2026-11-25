import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function cargarEnv() {
  const archivo = path.join(RAIZ, '.env');
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/** Ejecuta `npm <args>` de forma portable (sin shell). */
export function npm(args, env = process.env) {
  const cli = process.env.npm_execpath;
  const hijo = cli
    ? spawn(process.execPath, [cli, ...args], { cwd: RAIZ, stdio: 'inherit', env })
    : spawn('npm', args, { cwd: RAIZ, stdio: 'inherit', env, shell: process.platform === 'win32' });
  return new Promise((ok, mal) => {
    hijo.on('error', mal);
    hijo.on('exit', (c) => (c === 0 ? ok() : mal(new Error(`npm ${args.join(' ')} terminó con código ${c}`))));
  });
}
