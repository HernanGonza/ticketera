/** Validación del JWT del Portal del Ministerio y control de reuso por `jti`. */
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyOptions } from 'jose';
import type { Config } from '../config';
import { portalJti, type Ejecutor } from '../db';
import { mapearClaimsPortal, type ClaimsPortal } from './mapear-claims';

export const TOLERANCIA_SEG = 30;

type ConfigPortal = Pick<
  Config,
  | 'PORTAL_JWT_ALG'
  | 'PORTAL_JWT_SECRET'
  | 'PORTAL_JWT_PUBLIC_KEY'
  | 'PORTAL_JWT_JWKS_URL'
  | 'PORTAL_JWT_ISSUER'
  | 'PORTAL_JWT_AUDIENCE'
>;

/**
 * Devuelve un verificador. El algoritmo lo fija la configuración (nunca el encabezado del token) y el tipo
 * de clave depende de él: con RS256 el secreto no se usa, y con HS256 no se usa la clave pública.
 */
export function crearVerificadorPortal(config: ConfigPortal) {
  const alg = config.PORTAL_JWT_ALG;
  const opciones: JWTVerifyOptions = {
    algorithms: [alg],
    issuer: config.PORTAL_JWT_ISSUER,
    audience: config.PORTAL_JWT_AUDIENCE || undefined,
    clockTolerance: TOLERANCIA_SEG,
    requiredClaims: ['exp'],
  };
  const jwks =
    alg === 'RS256' && !config.PORTAL_JWT_PUBLIC_KEY && config.PORTAL_JWT_JWKS_URL
      ? createRemoteJWKSet(new URL(config.PORTAL_JWT_JWKS_URL))
      : null;
  let publica: ReturnType<typeof importSPKI> | undefined;

  return async (token: string): Promise<ClaimsPortal | null> => {
    try {
      let resultado;
      if (alg === 'HS256') {
        if (!config.PORTAL_JWT_SECRET) return null;
        resultado = await jwtVerify(token, new TextEncoder().encode(config.PORTAL_JWT_SECRET), opciones);
      } else if (jwks) {
        resultado = await jwtVerify(token, jwks, opciones);
      } else {
        if (!config.PORTAL_JWT_PUBLIC_KEY) return null;
        publica ??= importSPKI(config.PORTAL_JWT_PUBLIC_KEY.replace(/\\n/g, '\n'), 'RS256');
        resultado = await jwtVerify(token, await publica, opciones);
      }
      return mapearClaimsPortal(resultado.payload);
    } catch {
      return null;
    }
  };
}

/** Registra una clave de un solo uso (atómico por la clave primaria). false = ya se había usado. */
export async function usarUnaVez(db: Ejecutor, clave: string, expira: Date): Promise<boolean> {
  const id = clave.length <= 200 ? clave : createHash('sha256').update(clave).digest('hex');
  const filas = await db
    .insert(portalJti)
    .values({ jti: id, expiraAt: expira })
    .onConflictDoNothing()
    .returning({ jti: portalJti.jti });
  return filas.length > 0;
}

/** Consume el `jti` del token (si trae) durante toda su vigencia, tolerancia incluida. */
export const consumirJti = async (db: Ejecutor, c: ClaimsPortal) =>
  c.jti === null || usarUnaVez(db, `portal:${c.jti}`, new Date((c.exp + TOLERANCIA_SEG) * 1000));
