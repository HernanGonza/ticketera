/** Salud, catálogo, no leídos, notificaciones y estadísticas. */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  zCatalogo,
  zEstadisticas,
  zFiltroEstadisticas,
  zListaNotificaciones,
  zMarcarNotificaciones,
  zNoLeidos,
  zOk,
} from '@eco/shared/schemas';
import { exigirSesion, exigirStaff, usuarioDe } from '../auth/guardas';
import { listarNotificaciones, marcarNotificaciones, noLeidos, obtenerCatalogo, obtenerEstadisticas } from '../db';
import { CON_SESION, respuestas } from './comun';

export const rutasVarias: FastifyPluginAsyncZod = async (app) => {
  const { conexion } = app.deps;
  const { db } = conexion;
  const sesion = { security: CON_SESION };

  const zSalud = z.object({ ok: z.boolean(), db: z.boolean(), version: z.string() });
  app.get(
    '/api/health',
    { schema: { tags: ['sistema'], response: { 200: zSalud, 503: zSalud } } },
    async (_req, reply) => {
      try {
        await conexion.ping();
        return { ok: true, db: true, version: '1.0.0' };
      } catch {
        return reply.status(503).send({ ok: false, db: false, version: '1.0.0' });
      }
    },
  );

  app.get(
    '/api/catalogo',
    { onRequest: exigirSesion, schema: { ...sesion, tags: ['catalogo'], response: respuestas(zCatalogo) } },
    async (req) => obtenerCatalogo(db, usuarioDe(req)),
  );

  app.get(
    '/api/no-leidos',
    { onRequest: exigirSesion, schema: { ...sesion, tags: ['mensajes'], response: respuestas(zNoLeidos) } },
    async (req) => noLeidos(db, usuarioDe(req)),
  );

  app.get(
    '/api/notificaciones',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, tags: ['notificaciones'], response: respuestas(zListaNotificaciones) },
    },
    async (req) => listarNotificaciones(db, usuarioDe(req).id),
  );

  app.post(
    '/api/notificaciones/leer',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, tags: ['notificaciones'], body: zMarcarNotificaciones, response: respuestas(zOk) },
    },
    async (req) => {
      await marcarNotificaciones(db, usuarioDe(req).id, req.body.ids);
      return { ok: true as const };
    },
  );

  app.get(
    '/api/estadisticas',
    {
      onRequest: exigirStaff,
      schema: {
        ...sesion,
        tags: ['estadisticas'],
        querystring: zFiltroEstadisticas,
        response: respuestas(zEstadisticas),
      },
    },
    async (req) => obtenerEstadisticas(db, req.query),
  );
};
