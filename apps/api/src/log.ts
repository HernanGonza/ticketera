import { pino, type LoggerOptions } from 'pino';

const SENSIBLE = /token|email|jwt|password|secret|key|altcha/i;
/** Cualquier cadena con forma de JWT, esté donde esté (ruta incluida). */
const RE_JWT = /eyJ[\w-]*(?:\.|%2e)[\w-]*(?:\.|%2e)[\w-]*/gi;

const decodificar = (v: string) => {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    return null;
  }
};

/**
 * Quita tokens y datos personales de las URL antes de registrarlas. Se decodifican nombres y valores:
 * `%74oken=` o un `redirect` que lleve un token también se ocultan. Lo que no se puede decodificar se oculta.
 */
export function limpiarUrl(url: string): string {
  const corte = url.search(/[?#]/);
  const ruta = (corte < 0 ? url : url.slice(0, corte)).replace(RE_JWT, '[oculto]');
  if (corte < 0) return ruta;
  const resto = url
    .slice(corte + 1)
    .split(/([&;#?])/)
    .map((parte, i) => {
      if (i % 2) return parte;
      const igual = parte.indexOf('=');
      if (igual < 0) return parte.replace(RE_JWT, '[oculto]');
      const nombre = parte.slice(0, igual);
      const n = decodificar(nombre);
      const v = decodificar(parte.slice(igual + 1));
      const ocultar = n === null || v === null || SENSIBLE.test(n) || /token|eyJ/i.test(v);
      return `${nombre.replace(RE_JWT, '[oculto]')}=${ocultar ? '[oculto]' : parte.slice(igual + 1)}`;
    })
    .join('');
  return `${ruta}${url[corte]}${resto}`;
}

/**
 * Error apto para el log: los de la base traen la consulta con sus parámetros (correos, hashes), así que
 * se conserva solo la causa y la pila sin el mensaje.
 */
export function limpiarError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { mensaje: 'Error no identificado' };
  const causa = (e as { cause?: unknown }).cause;
  const consulta = e.message.startsWith('Failed query');
  const origen = consulta && causa instanceof Error ? causa : e;
  return {
    type: e.name,
    message: consulta && origen === e ? 'Falló una consulta a la base' : limpiarUrl(origen.message).slice(0, 500),
    code: (origen as { code?: unknown }).code,
    stack: (e.stack ?? '')
      .split('\n')
      .filter((l) => /^\s+at /.test(l))
      .slice(0, 12)
      .join('\n'),
  };
}

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
    err: limpiarError as (e: Error) => { type: string; message: string; stack: string },
  },
});
export const crearLog = (nombre: string, nivel?: string) => pino({ ...opcionesLog(nivel), name: nombre });
