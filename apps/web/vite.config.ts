import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { NOMBRE_SISTEMA } from '../../packages/shared/src/marca.ts';
import { svgFavicon } from './scripts/favicon.mjs';

const api = `http://127.0.0.1:${process.env.API_PORT ?? 3000}`;
const proxy = {
  '/api': api,
  '/auth': api,
  '/dev': api,
  '/socket.io': { target: api, ws: true },
};

/** Nombre del sistema desde la constante compartida y favicon pintado con los colores de tokens.css. */
function marca(): Plugin {
  const favicon = () => svgFavicon(readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8'));
  return {
    name: 'eco-marca',
    transformIndexHtml: (html) => html.replaceAll('%NOMBRE_SISTEMA%', NOMBRE_SISTEMA),
    configureServer(servidor) {
      servidor.middlewares.use('/favicon.svg', (_req, res) => {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(favicon());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: favicon() });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), marca()],
  server: { port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy },
  preview: { port: Number(process.env.WEB_PORT ?? 4173), strictPort: true, proxy },
});
