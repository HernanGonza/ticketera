import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Rol, UsuarioSesion } from '@eco/shared/dominio';
import { noAutenticado, sinPermiso } from '../errores';
import { COOKIE_SESION, verificarSesion } from './sesion';

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioSesion;
  }
}

export const exigirRol = (...roles: Rol[]): preHandlerAsyncHookHandler =>
  async function (req) {
    const token = req.cookies[COOKIE_SESION];
    const u = token ? await verificarSesion(token, this.deps.config.SESSION_SECRET) : null;
    if (!u) throw noAutenticado();
    if (roles.length && !roles.includes(u.rol)) throw sinPermiso();
    req.usuario = u;
  };
export const exigirSesion = exigirRol();
export const exigirStaff = exigirRol('tecnico', 'admin');
export const exigirAdmin = exigirRol('admin');

/** Usar dentro de un handler protegido. */
export function usuarioDe(req: { usuario?: UsuarioSesion }): UsuarioSesion {
  if (!req.usuario) throw noAutenticado();
  return req.usuario;
}
