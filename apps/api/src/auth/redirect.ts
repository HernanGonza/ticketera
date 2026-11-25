const BASE = 'http://interno.invalid';
const EXCLUIDAS = /^\/(login|no-habilitado|restablecer|recuperar|auth|api)(\/|$)/i;
// eslint-disable-next-line no-control-regex
const PELIGROSO = /[\u0000- \u007f\\]/;

/**
 * Destino tras ingresar: solo rutas internas de la web. Cualquier duda devuelve `/`.
 * Nunca conserva un parámetro `token`.
 */
export function redirectSeguro(destino: unknown): string {
  if (typeof destino !== 'string' || destino.length > 500) return '/';
  if (!destino.startsWith('/') || destino.startsWith('//') || PELIGROSO.test(destino)) return '/';
  let u: URL;
  let ruta: string;
  try {
    u = new URL(destino, BASE);
    ruta = decodeURIComponent(u.pathname);
  } catch {
    return '/';
  }
  // Sin barras codificadas, dobles codificaciones ni rutas que al normalizarse salgan del sitio.
  if (u.origin !== BASE || /%2f|%5c/i.test(u.pathname)) return '/';
  if (ruta.startsWith('//') || ruta.includes('%') || /[\\\u0080-\u009f]/.test(ruta) || PELIGROSO.test(ruta.replace(/ /g, '')))
    return '/';
  if (EXCLUIDAS.test(ruta)) return '/';
  for (const k of [...u.searchParams.keys()]) if (/token/i.test(k)) u.searchParams.delete(k);
  return `${u.pathname}${u.search}${u.hash}`;
}
