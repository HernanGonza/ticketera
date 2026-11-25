/** Visor de los correos que el worker guarda como archivo cuando no hay SMTP. Solo fuera de producción. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { noEncontrado } from '../errores';

/** Sin separadores de ruta ni nombres ocultos. */
const RE_ARCHIVO = /^[A-Za-z0-9][A-Za-z0-9@._-]{0,230}\.html$/;
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const html = (reply: FastifyReply, cuerpo: string) =>
  reply
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(cuerpo);

export const dev: FastifyPluginAsync = async (app) => {
  const carpeta = app.deps.config.mailsDir;
  const oculta = { schema: { hide: true } };

  app.get('/dev/mails', oculta, async (_req, reply) => {
    const archivos = (await readdir(carpeta).catch(() => []))
      .filter((a) => RE_ARCHIVO.test(a))
      .sort()
      .reverse()
      .slice(0, 300);
    const filas = archivos
      .map((a) => `<li><a href="/dev/mails/${encodeURIComponent(a)}">${escapar(a)}</a></li>`)
      .join('\n');
    return html(
      reply,
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Correos de desarrollo</title></head>
<body><h1>Correos de desarrollo</h1>${filas ? `<ul>\n${filas}\n</ul>` : '<p>Todavía no hay correos.</p>'}</body></html>`,
    );
  });

  app.get<{ Params: { archivo: string } }>('/dev/mails/:archivo', oculta, async (req, reply) => {
    const { archivo } = req.params;
    if (!RE_ARCHIVO.test(archivo)) throw noEncontrado('El correo');
    const contenido = await readFile(path.join(carpeta, archivo), 'utf8').catch(() => null);
    if (contenido === null) throw noEncontrado('El correo');
    return html(reply, contenido);
  });
};
