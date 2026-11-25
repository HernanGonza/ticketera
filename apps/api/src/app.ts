import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyReply } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NOMBRE_SISTEMA } from '@eco/shared/marca';
import { crearPersonal, type PersonalProvider } from './auth/personal';
import { COOKIE_SESION } from './auth/sesion';
import { rutasColas } from './colas';
import type { Deps } from './deps';
import { manejarError, manejarNoEncontrado } from './errores-http';
import { opcionesLog } from './log';
import { rutasAdjuntos } from './rutas/adjuntos';
import { rutasAdmin } from './rutas/admin';
import { rutasAuth } from './rutas/auth';
import { rutasMensajes } from './rutas/mensajes';
import { rutasPortal } from './rutas/portal';
import { rutasTickets } from './rutas/tickets';
import { rutasVarias } from './rutas/varios';
import { aplicarSeguridad } from './seguridad';

// Mensajes de validación en español.
z.config(z.locales.es());

export interface RutaRegistrada {
  metodo: string;
  url: string;
}
declare module 'fastify' {
  interface FastifyInstance {
    /** Todas las rutas registradas (la usa la prueba de la matriz de autorización). */
    rutasRegistradas: RutaRegistrada[];
  }
}

export interface OpcionesApp {
  /** Reemplaza el proveedor de Personal (pruebas). */
  personal?: PersonalProvider;
  /** Destino del log (pruebas). */
  log?: { write(linea: string): void };
}

export async function crearApp(deps: Deps, opciones: OpcionesApp = {}) {
  const app = Fastify({
    logger: { ...opcionesLog(deps.config.LOG_LEVEL), ...(opciones.log ? { stream: opciones.log } : {}) },
    trustProxy: deps.config.TRUST_PROXY,
    // Los correos de /dev/mails se nombran con destinatario y asunto: superan los 100 caracteres por defecto.
    routerOptions: { maxParamLength: 300 },
    // URL mal formada: respuesta genérica, sin repetirla (podría llevar un token).
    frameworkErrors: (_error, _req, reply) => {
      void (reply as unknown as FastifyReply).status(400).send({ error: 'validacion', mensaje: 'El pedido no es válido.' });
    },
  }).withTypeProvider<ZodTypeProvider>();
  app.decorate('deps', deps);
  app.decorate('rutasRegistradas', []);
  app.addHook('onRoute', (r) => {
    for (const metodo of [r.method].flat()) app.rutasRegistradas.push({ metodo, url: r.url });
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(manejarError);
  app.setNotFoundHandler(manejarNoEncontrado);
  // Solo JSON (más los formularios del portal y el multipart de adjuntos, cada uno en su módulo).
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  aplicarSeguridad(app);

  await app.register(swagger, {
    openapi: {
      info: { title: `${NOMBRE_SISTEMA} — API`, version: '1.0.0' },
      components: {
        securitySchemes: {
          sesion: { type: 'apiKey', in: 'cookie', name: COOKIE_SESION },
          portalKey: { type: 'apiKey', in: 'header', name: 'X-Portal-Key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs', staticCSP: true });

  const personal = opciones.personal ?? crearPersonal(deps.config);
  app.addHook('onClose', async () => {
    await personal.cerrar?.();
  });

  await app.register(rutasVarias);
  await app.register(rutasAuth, { personal });
  await app.register(rutasPortal, { personal });
  await app.register(rutasTickets);
  await app.register(rutasMensajes);
  await app.register(rutasAdjuntos);
  await app.register(rutasAdmin);
  await app.register(rutasColas);
  return app;
}
