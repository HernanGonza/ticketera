import { hash } from '@node-rs/argon2';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  zActualizarUsuario,
  zArea,
  zCategoria,
  zConfiguracion,
  zCrearUsuario,
  zFiltroUsuarios,
  zGuardarArea,
  zGuardarCategoria,
  zGuardarRespuestaRapida,
  zOk,
  zOrdenCategorias,
  zPaginaUsuarios,
  zRespuestaRapida,
  zUsuario,
} from '@eco/shared/schemas';
import { exigirAdmin, exigirStaff } from '../auth/guardas';
import {
  actualizarUsuario,
  crearUsuario,
  desactivarCategoria,
  eliminarRespuestaRapida,
  guardarArea,
  guardarCategoria,
  guardarConfiguracion,
  guardarRespuestaRapida,
  listarUsuarios,
  obtenerArea,
  obtenerCategoria,
  obtenerUsuario,
  ordenarCategorias,
} from '../db';
import { CON_SESION, respuestas, zParamNum, zParamUuid } from './comun';

export const rutasAdmin: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps.conexion;
  const admin = { tags: ['admin'], security: CON_SESION };
  const OK = { ok: true as const };

  const categoria = async (id: number) => (await obtenerCategoria(db, id))!;
  app.post(
    '/api/admin/categorias',
    { onRequest: exigirAdmin, schema: { ...admin, body: zGuardarCategoria, response: respuestas(zCategoria) } },
    async (req) => categoria(await guardarCategoria(db, req.body)),
  );
  app.put(
    '/api/admin/categorias/orden',
    { onRequest: exigirAdmin, schema: { ...admin, body: zOrdenCategorias, response: respuestas(zOk) } },
    async (req) => {
      await ordenarCategorias(db, req.body.ids);
      return OK;
    },
  );
  app.put(
    '/api/admin/categorias/:id',
    {
      onRequest: exigirAdmin,
      schema: { ...admin, params: zParamNum, body: zGuardarCategoria, response: respuestas(zCategoria) },
    },
    async (req) => categoria(await guardarCategoria(db, req.body, req.params.id)),
  );
  app.delete(
    '/api/admin/categorias/:id',
    { onRequest: exigirAdmin, schema: { ...admin, params: zParamNum, response: respuestas(zCategoria) } },
    async (req) => {
      await desactivarCategoria(db, req.params.id);
      return categoria(req.params.id);
    },
  );

  const area = async (id: number) => (await obtenerArea(db, id))!;
  app.post(
    '/api/admin/areas',
    { onRequest: exigirAdmin, schema: { ...admin, body: zGuardarArea, response: respuestas(zArea) } },
    async (req) => area(await guardarArea(db, req.body)),
  );
  app.put(
    '/api/admin/areas/:id',
    { onRequest: exigirAdmin, schema: { ...admin, params: zParamNum, body: zGuardarArea, response: respuestas(zArea) } },
    async (req) => area(await guardarArea(db, req.body, req.params.id)),
  );

  app.get(
    '/api/admin/usuarios',
    {
      onRequest: exigirAdmin,
      schema: { ...admin, querystring: zFiltroUsuarios, response: respuestas(zPaginaUsuarios) },
    },
    async (req) => listarUsuarios(db, req.query),
  );
  app.post(
    '/api/admin/usuarios',
    { onRequest: exigirAdmin, schema: { ...admin, body: zCrearUsuario, response: respuestas(zUsuario) } },
    async (req) => {
      const { password, ...datos } = req.body;
      const id = await crearUsuario(db, { ...datos, passwordHash: password ? await hash(password) : null });
      return (await obtenerUsuario(db, id))!;
    },
  );
  app.patch(
    '/api/admin/usuarios/:id',
    {
      onRequest: exigirAdmin,
      schema: { ...admin, params: zParamUuid, body: zActualizarUsuario, response: respuestas(zUsuario) },
    },
    async (req) => {
      const { password, ...cambios } = req.body;
      await actualizarUsuario(db, req.params.id, {
        ...cambios,
        ...(password ? { passwordHash: await hash(password) } : {}),
      });
      return (await obtenerUsuario(db, req.params.id))!;
    },
  );

  app.put(
    '/api/admin/configuracion',
    { onRequest: exigirAdmin, schema: { ...admin, body: zConfiguracion, response: respuestas(zConfiguracion) } },
    async (req) => guardarConfiguracion(db, req.body),
  );

  const staff = { tags: ['respuestas'], security: CON_SESION };
  app.post(
    '/api/admin/respuestas',
    {
      onRequest: exigirStaff,
      schema: { ...staff, body: zGuardarRespuestaRapida, response: respuestas(zRespuestaRapida) },
    },
    async (req) => ({ id: await guardarRespuestaRapida(db, req.body), ...req.body }),
  );
  app.put(
    '/api/admin/respuestas/:id',
    {
      onRequest: exigirStaff,
      schema: { ...staff, params: zParamNum, body: zGuardarRespuestaRapida, response: respuestas(zRespuestaRapida) },
    },
    async (req) => ({ id: await guardarRespuestaRapida(db, req.body, req.params.id), ...req.body }),
  );
  app.delete(
    '/api/admin/respuestas/:id',
    { onRequest: exigirStaff, schema: { ...staff, params: zParamNum, response: respuestas(zOk) } },
    async (req) => {
      await eliminarRespuestaRapida(db, req.params.id);
      return OK;
    },
  );
};
