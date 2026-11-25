/** Cliente HTTP: cookies de sesión, un único refresh ante 401 y errores uniformes. */
import type { CodigoError, ErrorApi } from '@eco/shared/schemas';

export class ErrorApiCliente extends Error {
  constructor(
    readonly status: number,
    readonly codigo: CodigoError | 'red',
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorApiCliente';
  }
}

export type ValorQuery = string | number | boolean | null | undefined | readonly string[];

/** Query string que omite vacíos y une listas con coma (así lo espera la API). */
export function aQuery(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, ValorQuery>)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(','));
    } else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface Opciones {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  signal?: AbortSignal;
}

let alExpirar: () => void = () => {};
/** Se invoca cuando la sesión no puede renovarse. */
export const alExpirarSesion = (fn: () => void) => {
  alExpirar = fn;
};

let refrescando: Promise<boolean> | null = null;
/** Renueva la sesión; los pedidos concurrentes comparten la misma llamada. */
export function refrescarSesion(): Promise<boolean> {
  refrescando ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refrescando = null;
    });
  return refrescando;
}

async function leerError(r: Response): Promise<ErrorApiCliente> {
  try {
    const c = (await r.json()) as Partial<ErrorApi>;
    if (c.error && c.mensaje) return new ErrorApiCliente(r.status, c.error, c.mensaje, c.detalles);
  } catch {
    /* respuesta sin JSON */
  }
  const mensaje =
    r.status >= 500
      ? 'El servidor no pudo procesar el pedido. Intente nuevamente en unos instantes.'
      : `No se pudo completar la operación (${r.status}).`;
  return new ErrorApiCliente(r.status, r.status === 401 ? 'no_autenticado' : 'interno', mensaje);
}

/** Rutas de autenticación cuyo 401 no debe disparar un refresh. */
const SIN_REFRESH = ['/api/auth/refresh', '/api/auth/login', '/api/auth/logout'];

export async function api<T>(ruta: string, op: Opciones = {}): Promise<T> {
  const esFormulario = typeof FormData !== 'undefined' && op.cuerpo instanceof FormData;
  const pedir = async () => {
    try {
      return await fetch(ruta, {
        method: op.metodo ?? 'GET',
        credentials: 'same-origin',
        signal: op.signal,
        headers: op.cuerpo === undefined || esFormulario ? undefined : { 'Content-Type': 'application/json' },
        body:
          op.cuerpo === undefined ? undefined : esFormulario ? (op.cuerpo as FormData) : JSON.stringify(op.cuerpo),
      });
    } catch (e) {
      if (op.signal?.aborted) throw e;
      throw new ErrorApiCliente(0, 'red', 'Sin conexión con el servidor. Verifique su red.');
    }
  };

  let r = await pedir();
  if (r.status === 401 && !SIN_REFRESH.includes(ruta)) {
    const error = await leerError(r);
    if (error.codigo !== 'no_autenticado') throw error;
    if (!(await refrescarSesion())) {
      alExpirar();
      throw error;
    }
    r = await pedir();
    if (r.status === 401) alExpirar();
  }
  if (!r.ok) throw await leerError(r);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}
