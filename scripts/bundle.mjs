// Empaqueta api / worker para producción. Los paquetes del monorepo se incluyen; el resto queda externo.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.argv[2];
const entradas = { api: ['src/server.ts', 'src/db/cli.ts'], worker: ['src/index.ts'] }[app];
if (!entradas) throw new Error('Uso: node scripts/bundle.mjs api|worker');
const base = path.join(raiz, 'apps', app);
rmSync(path.join(base, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: Object.fromEntries(entradas.map((e) => [path.basename(e, '.ts'), path.join(base, e)])),
  outdir: path.join(base, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externos',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (a) =>
          a.kind === 'entry-point' || a.path.startsWith('@eco/') || path.isAbsolute(a.path)
            ? undefined
            : { path: a.path, external: true },
        );
      },
    },
  ],
});
