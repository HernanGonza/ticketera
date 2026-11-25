import { queryOptions } from '@tanstack/react-query';
import type { AuthConfig, UsuarioActual } from '@eco/shared/schemas';
import { api } from './api';
import { claves } from './consultas';

export const qSesion = queryOptions({
  queryKey: claves.sesion,
  queryFn: () => api<UsuarioActual>('/api/auth/yo'),
  staleTime: 5 * 60_000,
  retry: false,
  meta: { silencioso: true },
});
export const qAuthConfig = queryOptions({
  queryKey: claves.authConfig,
  queryFn: () => api<AuthConfig>('/api/auth/config'),
  staleTime: Infinity,
});

export async function cerrarSesion() {
  const r = await api<{ redirigirA: string }>('/api/auth/logout', { metodo: 'POST' });
  window.location.assign(r.redirigirA);
}
