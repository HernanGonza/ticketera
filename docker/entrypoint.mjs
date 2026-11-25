// Arranque de la API en Docker: migraciones, datos iniciales, permisos de Metabase y servidor.
// El servidor se carga en este mismo proceso, así recibe directamente las señales del contenedor.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const SENALES = ['SIGINT', 'SIGTERM', 'SIGHUP'];
let hijo = null;
let interrumpido = false;

function reenviar(senal) {
  interrumpido = true;
  if (hijo) hijo.kill(senal);
  else process.exit(0);
}
for (const senal of SENALES) process.on(senal, reenviar);

function paso(args) {
  return new Promise((ok, mal) => {
    hijo = spawn(process.execPath, args, { cwd: raiz, stdio: 'inherit' });
    hijo.on('error', mal);
    hijo.on('exit', (codigo, senal) => {
      hijo = null;
      if (interrumpido) process.exit(0);
      if (codigo === 0) ok();
      else mal(new Error(`${args.join(' ')} terminó con ${senal ?? `código ${codigo}`}`));
    });
  });
}

try {
  await paso(['apps/api/dist/cli.js', 'migrar']);
  await paso(['apps/api/dist/cli.js', 'seed']);
  await paso(['docker/permisos-metabase.mjs']);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// A partir de acá las señales las maneja el propio servidor.
for (const senal of SENALES) process.off(senal, reenviar);
await import('../apps/api/dist/server.js');
