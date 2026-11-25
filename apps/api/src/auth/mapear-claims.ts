/** Único lugar que conoce los nombres de los claims del portal. Los desconocidos se ignoran. */
import { zEmail } from '@eco/shared/schemas';

export interface ClaimsPortal {
  email: string;
  nombre: string | null;
  sub: string | null;
  jti: string | null;
  /** Segundos desde la época. */
  exp: number;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function mapearClaimsPortal(claims: Record<string, unknown>): ClaimsPortal | null {
  const email = zEmail.safeParse(claims.email);
  if (!email.success || typeof claims.exp !== 'number') return null;
  const jti = claims.jti;
  return {
    email: email.data,
    nombre: texto(claims.nombre),
    sub: texto(claims.sub),
    jti: typeof jti === 'number' ? String(jti) : texto(jti),
    exp: claims.exp,
  };
}
