/** Rutas del panel de colas (solo administradores) y visor de correos de desarrollo. */
import type { FastifyPluginAsync } from 'fastify';
import { dev } from './dev-mails';
import { panel } from './panel';

export const rutasColas: FastifyPluginAsync = async (app) => {
  await app.register(panel);
  // En producción estas rutas no existen.
  if (!app.deps.config.produccion) await app.register(dev);
};
