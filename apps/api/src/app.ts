import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { rutasColas } from './colas';
import type { Deps } from './deps';
import { opcionesLog } from './log';

export async function crearApp(deps: Deps) {
  const app = Fastify({ logger: opcionesLog(deps.config.LOG_LEVEL), trustProxy: deps.config.TRUST_PROXY });
  app.decorate('deps', deps);
  await app.register(cookie);
  app.get('/api/health', async (_req, reply) => {
    try {
      await deps.conexion.ping();
      return { ok: true, db: true, version: '1.0.0' };
    } catch {
      return reply.status(503).send({ ok: false, db: false, version: '1.0.0' });
    }
  });
  await app.register(rutasColas);
  return app;
}
