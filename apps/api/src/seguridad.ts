/** Control de origen (CSRF) y encabezados de seguridad. No se habilita CORS. */
import type { FastifyInstance } from 'fastify';
import { ErrorHttp } from './errores';

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** El portal envía el token desde su propio sitio. */
const CRUZADAS = new Set(['/auth/portal']);

export function aplicarSeguridad(app: FastifyInstance) {
  const origenPropio = new URL(app.deps.config.appUrl).origin;

  app.addHook('onRequest', async (req, reply) => {
    reply.headers({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    });
    const ruta = req.routeOptions.url ?? '';
    // Swagger UI define su propia política.
    if (!ruta.startsWith('/api/docs') && !ruta.startsWith('/dev/'))
      reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    if (ruta.startsWith('/api/') || ruta.startsWith('/auth/')) reply.header('cache-control', 'no-store');

    // Sin `Origin` (servidor a servidor) no hay riesgo: los navegadores lo envían en toda mutación cruzada.
    const origen = req.headers.origin;
    if (!SEGUROS.has(req.method) && origen !== undefined && origen !== origenPropio && !CRUZADAS.has(ruta))
      throw new ErrorHttp(403, 'sin_permiso', 'El origen del pedido no está permitido.');
  });
}
