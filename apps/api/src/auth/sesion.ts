/** Contrato de sesión compartido por REST y Socket.IO. */
import { jwtVerify, SignJWT } from 'jose';
import type { UsuarioSesion } from '@eco/shared/dominio';

export const COOKIE_SESION = 'eco_sesion';
export const COOKIE_REFRESH = 'eco_refresh';
export const DURACION_SESION_SEG = 15 * 60;
export const DURACION_REFRESH_SEG = 7 * 24 * 3600;
const EMISOR = 'ecosoporte';
const clave = (secreto: string) => new TextEncoder().encode(secreto);

/** `familia` (claim `sid`) ata el token a su sesión: al revocarla deja de servir en el acto. */
export function firmarSesion(
  u: UsuarioSesion,
  secreto: string,
  duracionSeg = DURACION_SESION_SEG,
  familia?: string,
) {
  return new SignJWT({ email: u.email, nombre: u.nombre, rol: u.rol, areaId: u.areaId, sid: familia })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.id)
    .setIssuer(EMISOR)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + duracionSeg)
    .sign(clave(secreto));
}

export async function verificarSesion(
  token: string,
  secreto: string,
): Promise<(UsuarioSesion & { expira: number; familia?: string }) | null> {
  try {
    const { payload: p } = await jwtVerify(token, clave(secreto), { issuer: EMISOR, algorithms: ['HS256'] });
    return {
      id: p.sub as string,
      email: p.email as string,
      nombre: p.nombre as string,
      rol: p.rol as UsuarioSesion['rol'],
      areaId: (p.areaId as number | null) ?? null,
      expira: p.exp as number,
      familia: typeof p.sid === 'string' ? p.sid : undefined,
    };
  } catch {
    return null;
  }
}
