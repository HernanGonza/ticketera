import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart, { type FastifyMultipartOptions } from '@fastify/multipart';
import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { esStaff } from '@eco/shared/dominio';
import { zAdjunto } from '@eco/shared/schemas';
import { exigirSesion, usuarioDe } from '../auth/guardas';
import { limitarPorUsuario } from '../auth/limites';
import { adjuntos, obtenerAdjunto, obtenerMensaje, registrarAdjunto, tickets } from '../db';
import { ErrorHttp, noEncontrado, sinPermiso } from '../errores';
import { clasificarArchivo, sanearNombre } from './archivos';
import { CON_SESION, respuestas, ticketEditable, ticketVisible, zParamUuid, zRefTicket } from './comun';

export const MAX_ADJUNTOS_POR_TICKET = 50;
export const MAX_ADJUNTOS_POR_MENSAJE = 10;
/** Tope absoluto (la configuración no admite más). */
const MAX_ABSOLUTO = 50 * 1024 * 1024;
const EN_LINEA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

const invalido = (mensaje: string, status = 400) => new ErrorHttp(status, 'archivo_invalido', mensaje);

function disposicion(tipo: 'inline' | 'attachment', nombre: string) {
  const ascii = nombre.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const utf = encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${utf}`;
}

export const rutasAdjuntos: FastifyPluginAsyncZod = async (app) => {
  const { config, conexion } = app.deps;
  const { db } = conexion;
  const sesion = { tags: ['adjuntos'], security: CON_SESION };
  const raiz = path.resolve(config.uploadsDir);

  // `defParamCharset` es de busboy (los tipos del plugin no lo declaran): nombres de archivo en UTF-8.
  const opciones: FastifyMultipartOptions & { defParamCharset: string } = {
    limits: { fileSize: MAX_ABSOLUTO, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
    defParamCharset: 'utf8',
  };
  await app.register(multipart, opciones);

  app.post(
    '/api/tickets/:id/adjuntos',
    {
      onRequest: exigirSesion,
      preHandler: limitarPorUsuario(90),
      schema: {
        ...sesion,
        summary: 'Subir un archivo (multipart, campo `archivo`)',
        consumes: ['multipart/form-data'],
        params: zRefTicket,
        querystring: z.object({ mensajeId: z.uuid().optional() }),
        response: respuestas(zAdjunto, 201),
      },
    },
    async (req, reply) => {
      const u = usuarioDe(req);
      // Permisos antes de escribir nada en disco.
      const t = await ticketEditable(db, req.params.id, u);
      const { mensajeId } = req.query;
      if (mensajeId) {
        const m = await obtenerMensaje(db, mensajeId);
        if (!m || m.ticketId !== t.id || (m.interno && !esStaff(u))) throw noEncontrado('El mensaje');
        if (m.autor.id !== u.id) throw sinPermiso();
      }
      if (!req.isMultipart()) throw invalido('Envíe el archivo como multipart/form-data.');

      const maximo = t.config.adjuntoMaxMb * 1024 * 1024;
      const muyGrande = () => invalido(`El archivo supera el máximo de ${t.config.adjuntoMaxMb} MB.`, 413);
      const parte = await req.file({ limits: { fileSize: maximo }, throwFileSizeLimit: false });
      if (!parte || parte.fieldname !== 'archivo') {
        parte?.file.resume();
        throw invalido('Falta el archivo (campo «archivo»).');
      }

      const ahora = new Date();
      const carpeta = path.posix.join(String(ahora.getUTCFullYear()), String(ahora.getUTCMonth() + 1).padStart(2, '0'));
      const base = randomUUID();
      const temporal = path.join(raiz, carpeta, `${base}.tmp`);
      let final: string | null = null;
      await mkdir(path.dirname(temporal), { recursive: true });
      try {
        await pipeline(parte.file, createWriteStream(temporal, { flags: 'wx', mode: 0o640 }));
        if (parte.file.truncated) throw muyGrande();
        const { size } = await stat(temporal);
        if (!size) throw invalido('El archivo está vacío.');
        const tipo = await clasificarArchivo(temporal, sanearNombre(parte.filename));
        const { adjuntosPermitidos } = app.deps.config;
        if (tipo && adjuntosPermitidos.length && !adjuntosPermitidos.includes(tipo.extension))
          throw invalido(`El tipo de archivo no está permitido. Admitidos: ${adjuntosPermitidos.join(', ')}.`);
        if (!tipo)
          throw invalido(
            'El tipo de archivo no está permitido. Admitidos: imágenes, PDF, documentos de Office u OpenDocument, TXT, CSV, LOG, ZIP y MP4.',
          );
        const ruta = path.posix.join(carpeta, `${base}.${tipo.extension}`);
        final = path.join(raiz, ruta);
        await rename(temporal, final);

        const id = await db.transaction(async (tx) => {
          // Serializa las subidas del ticket para que los topes se respeten.
          await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, t.id)).for('update');
          const [n] = await tx
            .select({
              total: count(),
              delMensaje: mensajeId
                ? sql<number>`count(*) filter (where ${adjuntos.mensajeId} = ${mensajeId})::int`
                : sql<number>`0`,
            })
            .from(adjuntos)
            .where(and(eq(adjuntos.ticketId, t.id)));
          if (n!.total >= MAX_ADJUNTOS_POR_TICKET)
            throw invalido(`Un pedido admite hasta ${MAX_ADJUNTOS_POR_TICKET} archivos.`);
          if (n!.delMensaje >= MAX_ADJUNTOS_POR_MENSAJE)
            throw invalido(`Un mensaje admite hasta ${MAX_ADJUNTOS_POR_MENSAJE} archivos.`);
          return registrarAdjunto(
            tx,
            { ticketId: t.id, mensajeId, ruta, nombre: tipo.nombre, mime: tipo.mime, bytes: size },
            u,
          );
        });
        const a = (await obtenerAdjunto(db, id))!;
        final = null;
        return reply.status(201).send(a);
      } catch (e) {
        if (final) await rm(final, { force: true });
        throw e;
      } finally {
        await rm(temporal, { force: true });
      }
    },
  );

  app.get(
    '/api/adjuntos/:id',
    {
      onRequest: exigirSesion,
      schema: {
        ...sesion,
        summary: 'Contenido del archivo',
        params: zParamUuid,
        querystring: z.object({ descargar: z.enum(['0', '1']).optional() }),
      },
    },
    async (req, reply) => {
      const u = usuarioDe(req);
      const a = await obtenerAdjunto(db, req.params.id);
      if (!a) throw noEncontrado('El archivo');
      await ticketVisible(db, a.ticketId, u).catch((e: unknown) => {
        throw e instanceof ErrorHttp ? noEncontrado('El archivo') : e;
      });
      if (a.interno && !esStaff(u)) throw noEncontrado('El archivo');
      const archivo = path.resolve(raiz, a.ruta);
      if (!archivo.startsWith(raiz + path.sep)) throw noEncontrado('El archivo');
      const f = await open(archivo, 'r').catch(() => null);
      if (!f) throw noEncontrado('El archivo');
      const { size } = await f.stat();
      const enLinea = req.query.descargar !== '1' && EN_LINEA.has(a.mime);
      return reply
        .headers({
          'content-type': a.mime.startsWith('text/') ? `${a.mime}; charset=utf-8` : a.mime,
          'content-length': size,
          'content-disposition': disposicion(enLinea ? 'inline' : 'attachment', a.nombre),
          'cache-control': 'private, max-age=300',
          // El visor de PDF del navegador no funciona dentro de un sandbox.
          'content-security-policy':
            a.mime === 'application/pdf'
              ? "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'"
              : "sandbox; default-src 'none'; frame-ancestors 'self'",
        })
        .send(f.createReadStream());
    },
  );
};
