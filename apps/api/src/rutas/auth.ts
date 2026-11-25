import { setTimeout as esperar } from 'node:timers/promises';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ROLES } from '@eco/shared/dominio';
import {
  zAuthConfig,
  zDevToken,
  zLogin,
  zOk,
  zRecuperar,
  zRestablecer,
  zUsuarioSesion,
} from '@eco/shared/schemas';
import { crearDesafio, exigirCaptcha } from '../auth/captcha';
import { puedeFirmarDev, urlPortalDev } from '../auth/dev';
import { exigirSesion, usuarioDe } from '../auth/guardas';
import { registrarAcceso, resolverIngreso } from '../auth/ingreso';
import { crearLimitador } from '../auth/limites';
import type { PersonalProvider } from '../auth/personal';
import { restablecerPassword } from '../auth/recupero';
import { abrirSesion, borrarCookies, cerrarSesionActual, renovarSesion } from '../auth/sesiones';
import { buscarUsuarioPorEmail, obtenerUsuarioSesion, solicitarRecuperacion, USUARIOS_DEMO } from '../db';
import { ErrorHttp, noAutenticado, noEncontrado } from '../errores';
import { limpiarError } from '../log';
import { CON_SESION, respuestas } from './comun';

const MINUTO = 60_000;
/** Piso de duración del pedido de recupero: no delata si el correo existe. */
const PISO_RECUPERO_MS = 250;

const credencialesInvalidas = () =>
  new ErrorHttp(401, 'credenciales_invalidas', 'El correo o la contraseña no son correctos.');
const noHabilitado = () => new ErrorHttp(403, 'usuario_no_habilitado', 'Su usuario no está habilitado.');

export const rutasAuth: FastifyPluginAsyncZod<{ personal: PersonalProvider }> = async (app, { personal }) => {
  const { config, conexion } = app.deps;
  const { db } = conexion;
  const max = config.LOGIN_MAX_INTENTOS;
  const porIp = crearLimitador(max, MINUTO);
  const porEmail = crearLimitador(max, MINUTO);
  const desafios = crearLimitador(max * 6, MINUTO);
  const recuperoIp = crearLimitador(max, 15 * MINUTO);
  const recuperoEmail = crearLimitador(Math.min(max, 5), 15 * MINUTO);
  const restablecerIp = crearLimitador(max, 15 * MINUTO);
  const renovaciones = crearLimitador(max * 30, MINUTO);
  /** Hash de relleno: un correo inexistente tarda lo mismo que una contraseña incorrecta. */
  const relleno = await hash('relleno-sin-usuario');

  const tags = ['auth'];

  app.get(
    '/api/auth/config',
    { schema: { tags, summary: 'Opciones de la pantalla de ingreso', response: respuestas(zAuthConfig) } },
    async () => {
      const modoDev = puedeFirmarDev(config);
      return {
        portalUrl: config.PORTAL_URL,
        modoDev,
        accesosDev: modoDev
          ? ROLES.flatMap((rol) => {
              const u = USUARIOS_DEMO.find((x) => x.rol === rol);
              return u ? [{ rol, email: u.email }] : [];
            })
          : [],
      };
    },
  );

  if (!config.produccion)
    app.post(
      '/api/auth/dev/token',
      {
        schema: {
          tags,
          summary: 'Enlace de ingreso de prueba (solo desarrollo)',
          body: zDevToken,
          response: respuestas(z.object({ url: z.string() })),
        },
      },
      async (req) => {
        const u = USUARIOS_DEMO.find((x) => x.rol === req.body.rol);
        if (!u || !puedeFirmarDev(config)) throw noEncontrado('El acceso de prueba');
        return { url: await urlPortalDev(config, u.email, { nombre: u.nombre }) };
      },
    );

  app.get(
    '/api/auth/altcha',
    {
      onRequest: async (req) => desafios.consumir(req.ip),
      schema: {
        tags,
        summary: 'Desafío ALTCHA',
        response: respuestas(
          z.object({
            algorithm: z.string(),
            challenge: z.string(),
            maxnumber: z.number().optional(),
            salt: z.string(),
            signature: z.string(),
          }),
        ),
      },
    },
    async () => crearDesafio(config),
  );

  app.post(
    '/api/auth/login',
    {
      onRequest: async (req) => porIp.consumir(req.ip),
      schema: { tags, summary: 'Ingreso local', body: zLogin, response: respuestas(zUsuarioSesion) },
    },
    async (req, reply) => {
      const { email, password, altcha } = req.body;
      porEmail.consumir(email);
      await exigirCaptcha(db, config, altcha);
      const u = await buscarUsuarioPorEmail(db, email);
      const correcta = await verify(u?.passwordHash ?? relleno, password).catch(() => false);
      if (!u?.passwordHash || !correcta) throw credencialesInvalidas();
      const id = await resolverIngreso(db, personal, email, {
        tolerarFallo: true,
        alFallar: (e) => req.log.warn({ err: limpiarError(e) }, 'No se pudo consultar Personal'),
      });
      const sesion = id ? await abrirSesion(app.deps, req, reply, id) : null;
      if (!sesion) throw noHabilitado();
      await registrarAcceso(db, sesion.id);
      return sesion;
    },
  );

  app.post(
    '/api/auth/recuperar',
    {
      onRequest: async (req) => recuperoIp.consumir(req.ip),
      schema: { tags, summary: 'Pedir el enlace de recupero', body: zRecuperar, response: respuestas(zOk) },
    },
    async (req) => {
      const { email, altcha } = req.body;
      recuperoEmail.consumir(email);
      await exigirCaptcha(db, config, altcha);
      const piso = esperar(PISO_RECUPERO_MS);
      const u = await buscarUsuarioPorEmail(db, email);
      if (u?.activo) await solicitarRecuperacion(db, u.id);
      await piso;
      return { ok: true as const };
    },
  );

  app.post(
    '/api/auth/restablecer',
    {
      onRequest: async (req) => restablecerIp.consumir(req.ip),
      schema: { tags, summary: 'Cambiar la contraseña con el enlace', body: zRestablecer, response: respuestas(zOk) },
    },
    async (req, reply) => {
      await restablecerPassword(db, req.body.token, req.body.password);
      borrarCookies(app.deps, reply);
      return { ok: true as const };
    },
  );

  app.post(
    '/api/auth/refresh',
    {
      onRequest: async (req) => renovaciones.consumir(req.ip),
      schema: { tags, summary: 'Renovar la sesión', response: respuestas(zUsuarioSesion) },
    },
    async (req, reply) => {
      const u = await renovarSesion(app.deps, req, reply);
      if (!u) {
        borrarCookies(app.deps, reply);
        throw noAutenticado();
      }
      return u;
    },
  );

  app.post(
    '/api/auth/logout',
    {
      schema: { tags, summary: 'Cerrar sesión', response: respuestas(z.object({ redirigirA: z.string() })) },
    },
    async (req, reply) => {
      await cerrarSesionActual(app.deps, req);
      borrarCookies(app.deps, reply);
      return { redirigirA: config.portalLogoutUrl };
    },
  );

  app.get(
    '/api/auth/yo',
    {
      onRequest: exigirSesion,
      schema: { tags, summary: 'Usuario actual', security: CON_SESION, response: respuestas(zUsuarioSesion) },
    },
    async (req) => {
      const u = await obtenerUsuarioSesion(db, usuarioDe(req).id);
      if (!u) throw noAutenticado();
      return u;
    },
  );
};
