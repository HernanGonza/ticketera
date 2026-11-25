import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { esStaff } from '@eco/shared/dominio';
import { zCrearMensaje, zEditarMensaje, zLectura, zMensaje, zOk } from '@eco/shared/schemas';
import { exigirSesion, usuarioDe } from '../auth/guardas';
import { limitarPorUsuario } from '../auth/limites';
import { crearMensaje, editarMensaje, listarMensajes, marcarLeido, obtenerMensaje } from '../db';
import { CON_SESION, respuestas, ticketEditable, ticketVisible, zParamUuid, zRefTicket } from './comun';

export const rutasMensajes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps.conexion;
  const sesion = { tags: ['mensajes'], security: CON_SESION };

  app.get(
    '/api/tickets/:id/mensajes',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, params: zRefTicket, response: respuestas(z.object({ items: z.array(zMensaje) })) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketVisible(db, req.params.id, u);
      return { items: await listarMensajes(db, t.id, { incluirInternos: esStaff(u) }) };
    },
  );

  app.post(
    '/api/tickets/:id/mensajes',
    {
      onRequest: exigirSesion,
      preHandler: limitarPorUsuario(90),
      schema: { ...sesion, params: zRefTicket, body: zCrearMensaje, response: respuestas(zMensaje, 201) },
    },
    async (req, reply) => {
      const u = usuarioDe(req);
      const t = await ticketEditable(db, req.params.id, u);
      const { id } = await crearMensaje(db, { ticketId: t.id, ...req.body }, u);
      return reply.status(201).send((await obtenerMensaje(db, id))!);
    },
  );

  app.patch(
    '/api/mensajes/:id',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, params: zParamUuid, body: zEditarMensaje, response: respuestas(zMensaje) },
    },
    async (req) => {
      await editarMensaje(db, req.params.id, req.body.cuerpo, usuarioDe(req));
      return (await obtenerMensaje(db, req.params.id))!;
    },
  );

  app.post(
    '/api/tickets/:id/lectura',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, params: zRefTicket, body: zLectura, response: respuestas(zOk) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketVisible(db, req.params.id, u);
      await marcarLeido(db, t.id, u, req.body.ultimoMensajeId);
      return { ok: true as const };
    },
  );
};
