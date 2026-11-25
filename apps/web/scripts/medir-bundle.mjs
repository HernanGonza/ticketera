/** Suma el gzip de los scripts y modulepreload de index.html y falla si supera el límite. */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const LIMITE_KB = Number(process.env.LIMITE_KB ?? 150);
const dist = new URL('../dist/', import.meta.url);
const index = new URL('index.html', dist);
if (!existsSync(index)) {
  console.error('No existe dist/index.html. Ejecute antes: npm run build -w @eco/web');
  process.exit(1);
}
const html = readFileSync(index, 'utf8');
const rutas = new Set();
for (const [etiqueta] of html.matchAll(/<(script|link)\b[^>]*>/g)) {
  const esScript = etiqueta.startsWith('<script');
  if (!esScript && !/rel="modulepreload"/.test(etiqueta)) continue;
  const m = etiqueta.match(esScript ? /\ssrc="([^"]+)"/ : /\shref="([^"]+)"/);
  if (m) rutas.add(m[1]);
}

const medir = (ruta) => {
  const contenido = readFileSync(fileURLToPath(new URL(ruta.replace(/^\//, ''), dist)));
  return { ruta, bytes: contenido.length, gzip: gzipSync(contenido, { level: 9 }).length };
};
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const filas = [...rutas].map(medir);
for (const f of filas) console.log(`${kb(f.gzip).padStart(10)} gzip  ${kb(f.bytes).padStart(10)}  ${f.ruta}`);
const total = filas.reduce((a, f) => a + f.gzip, 0);
console.log(`\nJavaScript inicial: ${kb(total)} gzip (límite ${LIMITE_KB} KB)`);
for (const [, css] of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g))
  console.log(`CSS inicial: ${kb(medir(css).gzip)} gzip`);
if (!filas.length || total > LIMITE_KB * 1024) {
  console.error('El paquete inicial excede el límite (o no se encontraron scripts).');
  process.exit(1);
}
