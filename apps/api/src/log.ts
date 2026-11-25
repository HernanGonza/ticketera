import { pino, type LoggerOptions } from 'pino';

/** Quita tokens de las URL antes de registrarlas. */
export const limpiarUrl = (url: string) => url.replace(/([?&](?:token|email)=)[^&]*/gi, '$1[oculto]');

export const opcionesLog = (nivel = process.env.LOG_LEVEL ?? 'info'): LoggerOptions => ({
  level: nivel,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-portal-key"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.altcha',
    ],
    censor: '[oculto]',
  },
  serializers: {
    req: (r: { method: string; url: string; ip?: string }) => ({ method: r.method, url: limpiarUrl(r.url), ip: r.ip }),
  },
});
export const crearLog = (nombre: string, nivel?: string) => pino({ ...opcionesLog(nivel), name: nombre });
