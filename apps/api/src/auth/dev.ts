/** Token de portal de prueba (solo fuera de producción y con HS256). */
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Config } from '../config';

export const puedeFirmarDev = (c: Config) => !c.produccion && c.PORTAL_JWT_ALG === 'HS256' && !!c.PORTAL_JWT_SECRET;

export async function urlPortalDev(config: Config, email: string, opciones: { nombre?: string; redirect?: string } = {}) {
  if (!puedeFirmarDev(config))
    throw new Error('El token de prueba requiere un entorno que no sea de producción, HS256 y PORTAL_JWT_SECRET.');
  const jwt = new SignJWT({ email, nombre: opciones.nombre })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setJti(randomUUID())
    .setIssuer(config.PORTAL_JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m');
  if (config.PORTAL_JWT_AUDIENCE) jwt.setAudience(config.PORTAL_JWT_AUDIENCE);
  const url = new URL(`${config.appUrl}/auth/portal`);
  url.searchParams.set('token', await jwt.sign(new TextEncoder().encode(config.PORTAL_JWT_SECRET)));
  if (opciones.redirect) url.searchParams.set('redirect', opciones.redirect);
  return url.toString();
}
