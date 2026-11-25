import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Rol, UsuarioSesion } from '@eco/shared/dominio';
import { esUuid, sesiones, usuarios, type Ejecutor } from '../db';
import { noAutenticado, sinPermiso } from '../errores';
import { COOKIE_SESION, verificarSesion } from './sesion';

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioSesion;
  }
}

/**
 * Usuario de un token de sesión contrastado con la base: debe seguir activo, con el mismo rol y con su
 * sesión sin revocar. Nombre, correo y área salen de la base. Sirve también para Socket.IO.
 */
export async function usuarioVigente(db: Ejecutor, token: string, secreto: string): Promise<UsuarioSesion | null> {
  const t = await verificarSesion(token, secreto);
  // Todo token válido pertenece a una sesión registrada: sin ella no alcanza con la firma.
  const familia = t?.familia;
  if (!t || !esUuid(t.id) || !familia || !esUuid(familia)) return null;
  const [u] = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nombre: usuarios.nombre,
      rol: usuarios.rol,
      areaId: usuarios.areaId,
    })
    .from(usuarios)
    .where(
      and(
        eq(usuarios.id, t.id),
        eq(usuarios.activo, true),
        sql`exists (${db
          .select({ uno: sql`1` })
          .from(sesiones)
          .where(
            and(
              eq(sesiones.familia, familia),
              eq(sesiones.usuarioId, usuarios.id),
              isNull(sesiones.revocadoAt),
              gt(sesiones.expiraAt, new Date()),
            ),
          )})`,
      ),
    );
  return u && u.rol === t.rol ? u : null;
}

/** Usar como `onRequest` (así se rechaza antes de validar la entrada) o como `preHandler`. */
export const exigirRol = (...roles: Rol[]): preHandlerAsyncHookHandler =>
  async function (req) {
    const token = req.cookies[COOKIE_SESION];
    const u = token ? await usuarioVigente(this.deps.conexion.db, token, this.deps.config.SESSION_SECRET) : null;
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
