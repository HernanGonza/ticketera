/** Solo rutas internas: evita redirecciones abiertas a partir de parámetros. */
export function rutaInterna(r: unknown): string | undefined {
  if (typeof r !== 'string' || !r.startsWith('/') || r.startsWith('//') || r.includes('\\')) return undefined;
  if (/^\/(login|no-habilitado|restablecer|recuperar|auth|api)(\/|\?|#|$)/.test(r)) return undefined;
  return r;
}

/** Enlace al Portal conservando la ruta pedida en `redirect`. */
export function enlacePortal(portalUrl: string, redirect?: string): string {
  if (!redirect) return portalUrl;
  try {
    const u = new URL(portalUrl, 'http://local.invalid');
    u.searchParams.set('redirect', redirect);
    return u.host === 'local.invalid' ? `${u.pathname}${u.search}${u.hash}` : u.toString();
  } catch {
    return portalUrl;
  }
}
