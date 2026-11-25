/** Ingreso Único: entrada con el JWT del portal y consulta de existencia para su botonera. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { zEmail, zError, zPortalBody, zUsuarioExiste, type CodigoError } from '@eco/shared/schemas';
import { registrarAcceso, resolverIngreso } from '../auth/ingreso';
import { crearLimitador } from '../auth/limites';
import type { PersonalProvider } from '../auth/personal';
import { consumirJti, crearVerificadorPortal } from '../auth/portal-jwt';
import { redirectSeguro } from '../auth/redirect';
import { abrirSesion } from '../auth/sesiones';
import { buscarUsuarioPorEmail } from '../db';
import { ErrorHttp, noEncontrado } from '../errores';
import { limpiarError } from '../log';
import { respuestas } from './comun';

const MINUTO = 60_000;

const zConsulta = z.object({
  token: z.string().max(8000).optional(),
  redirect: z.string().max(500).optional(),
});

const digerir = (v: string) => createHash('sha256').update(v).digest();

export const rutasPortal: FastifyPluginAsyncZod<{ personal: PersonalProvider }> = async (app, { personal }) => {
  const { config, conexion } = app.deps;
  const { db } = conexion;
  const verificar = crearVerificadorPortal(config);
  // Muchos empleados comparten IP de salida: el margen es amplio.
  const ingresos = crearLimitador(Math.max(120, config.LOGIN_MAX_INTENTOS), MINUTO);
  const consultas = crearLimitador(300, MINUTO);
  const clavesMalas = crearLimitador(20, MINUTO);

  // Formularios solo en este módulo (el portal puede enviar el token por POST).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, texto, listo) =>
    listo(null, Object.fromEntries(new URLSearchParams(texto as string))),
  );

  const volver = (reply: FastifyReply, codigo: CodigoError) =>
    reply.redirect(codigo === 'usuario_no_habilitado' ? '/no-habilitado' : `/login?error=${codigo}`, 303);

  async function ingresar(req: FastifyRequest, reply: FastifyReply, token: string | undefined, destino: unknown) {
    if (!token) return volver(reply, 'validacion');
    const claims = await verificar(token);
    if (!claims || !(await consumirJti(db, claims))) return volver(reply, 'token_invalido');
    const id = await resolverIngreso(db, personal, claims.email);
    const sesion = id ? await abrirSesion(app.deps, req, reply, id) : null;
    if (!sesion) return volver(reply, 'usuario_no_habilitado');
    await registrarAcceso(db, sesion.id);
    return reply.redirect(redirectSeguro(destino), 303);
  }

  const delEncabezado = (req: FastifyRequest) => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];

  // Es una navegación del navegador: los errores terminan en una pantalla, no en JSON.
  const comun = {
    onRequest: async (req: FastifyRequest) => ingresos.consumir(req.ip),
    errorHandler: (error: Error & { statusCode?: number }, req: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof ErrorHttp) return volver(reply, error.codigo);
      if (error.statusCode && error.statusCode < 500) return volver(reply, 'validacion');
      req.log.error({ err: limpiarError(error) }, 'Falló el ingreso por el portal');
      return volver(reply, 'interno');
    },
  };
  const descripcion = 'Responde 303 a la ruta pedida (con sesión), a /no-habilitado o a /login?error=…';

  app.get(
    '/auth/portal',
    {
      ...comun,
      // Un HEAD (verificadores de enlaces) no debe consumir el token.
      exposeHeadRoute: false,
      schema: {
        tags: ['sso'],
        summary: 'Ingreso con el token del portal',
        description: descripcion,
        querystring: zConsulta,
      },
    },
    async (req, reply) => ingresar(req, reply, req.query.token || delEncabezado(req), req.query.redirect),
  );

  app.post(
    '/auth/portal',
    {
      ...comun,
      bodyLimit: 16_384,
      schema: {
        tags: ['sso'],
        summary: 'Ingreso con el token del portal (JSON o formulario)',
        description: descripcion,
        querystring: zConsulta,
        body: zPortalBody,
      },
    },
    async (req, reply) => ingresar(req, reply, req.body.token, req.body.redirect ?? req.query.redirect),
  );

  app.get(
    '/api/sso/usuario-existe',
    {
      // La clave se controla antes que la entrada: sin ella no se informa nada.
      onRequest: async (req) => {
        if (!config.PORTAL_API_KEY) throw noEncontrado('El recurso');
        consultas.consumir(req.ip);
        const clave = req.headers['x-portal-key'];
        if (typeof clave !== 'string' || !timingSafeEqual(digerir(clave), digerir(config.PORTAL_API_KEY))) {
          clavesMalas.consumir(req.ip);
          throw new ErrorHttp(401, 'no_autenticado', 'La clave del portal no es válida.');
        }
      },
      schema: {
        tags: ['sso'],
        summary: 'Indica al portal si un correo puede ingresar',
        security: [{ portalKey: [] }],
        querystring: z.object({ email: zEmail }),
        response: { ...respuestas(zUsuarioExiste), 401: zError },
      },
    },
    async (req) => {
      const { email } = req.query;
      const local = await buscarUsuarioPorEmail(db, email);
      const empleado = await personal.buscarPorEmail(email).catch((e: unknown) => {
        req.log.warn({ err: limpiarError(e) }, 'No se pudo consultar Personal');
        return null;
      });
      const existe = empleado ? empleado.activo && !local?.bloqueado : !!local?.activo;
      return existe ? { existe, rol: local?.rol ?? ('solicitante' as const) } : { existe };
    },
  );
};
