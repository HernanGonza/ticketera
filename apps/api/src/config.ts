import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

function buscarRaiz(desde: string): string {
  let dir = desde;
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
    const padre = path.dirname(dir);
    if (padre === dir) return process.cwd();
    dir = padre;
  }
}
export const RAIZ = buscarRaiz(path.dirname(fileURLToPath(import.meta.url)));

const texto = z.string().trim().default('');
const booleano = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const zEnv = z.object({
  // Sin definir se asume producción: los atajos de desarrollo hay que pedirlos.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  APP_URL: z.string().default('http://localhost:5173'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgres://eco:eco@127.0.0.1:5433/ecosoporte'),
  DATA_DIR: z.string().default('.data'),
  UPLOADS_DIR: texto,
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: booleano(false),
  SESSION_SECRET: texto,
  COOKIE_SECURE: z.string().optional(),
  ALTCHA_HMAC_KEY: texto,
  ALTCHA_COSTO: z.coerce.number().int().min(1).default(50_000),
  LOGIN_MAX_INTENTOS: z.coerce.number().int().min(1).default(10),
  PORTAL_URL: z.string().default('https://portal.ecologia.misiones.gob.ar'),
  PORTAL_LOGOUT_URL: texto,
  PORTAL_JWT_ALG: z.enum(['HS256', 'RS256']).default('HS256'),
  PORTAL_JWT_SECRET: texto,
  PORTAL_JWT_PUBLIC_KEY: texto,
  PORTAL_JWT_JWKS_URL: texto,
  PORTAL_JWT_ISSUER: z.string().default('portal.ecologia.misiones.gob.ar'),
  PORTAL_JWT_AUDIENCE: texto,
  PORTAL_API_KEY: texto,
  PERSONAL_DATABASE_URL: texto,
  SMTP_HOST: texto,
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: booleano(false),
  SMTP_USER: texto,
  SMTP_PASSWORD: texto,
  MAIL_FROM: z.string().default('ECOsoporte <no-responder@ecologia.misiones.gob.ar>'),
  /** Extensiones admitidas separadas por coma; vacío = todas las que el sistema sabe verificar. */
  ADJUNTOS_PERMITIDOS: texto,
  SEED_DEMO: z.string().optional(),
  ADMIN_EMAIL: texto,
  ADMIN_PASSWORD: texto,
});

/** Valores que solo se usan fuera de producción para que `npm run dev` funcione sin `.env`. */
const SECRETOS_DEV = {
  SESSION_SECRET: 'dev-solo-session-secret-no-usar-en-produccion',
  ALTCHA_HMAC_KEY: 'dev-solo-altcha-no-usar-en-produccion',
  PORTAL_JWT_SECRET: 'dev-solo-portal-jwt-secret-no-usar-en-produccion',
  PORTAL_API_KEY: 'dev-solo-portal-api-key',
} as const;

/** Valores de `.env.example` o de desarrollo: son públicos y no sirven como secreto. */
export const esValorDeEjemplo = (v: string) => /^(cambiar|dev-solo)/i.test(v);

export function cargarConfig(env: Record<string, string | undefined> = process.env) {
  const limpio = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const e = zEnv.parse(limpio);
  const produccion = e.NODE_ENV === 'production';
  if (!produccion) {
    for (const [k, v] of Object.entries(SECRETOS_DEV) as [keyof typeof SECRETOS_DEV, string][])
      e[k] ||= v;
  } else {
    // Con el valor de ejemplo, el ingreso por el portal y su consulta quedan deshabilitados.
    for (const k of ['PORTAL_JWT_SECRET', 'PORTAL_API_KEY'] as const) if (esValorDeEjemplo(e[k])) e[k] = '';
    const faltan: string[] = (['SESSION_SECRET', 'ALTCHA_HMAC_KEY'] as const).filter(
      (k) => e[k].length < 32 || esValorDeEjemplo(e[k]),
    );
    if (e.PORTAL_API_KEY && e.PORTAL_API_KEY.length < 24) faltan.push('PORTAL_API_KEY');
    if (e.PORTAL_JWT_ALG === 'HS256' && e.PORTAL_JWT_SECRET && e.PORTAL_JWT_SECRET.length < 32)
      faltan.push('PORTAL_JWT_SECRET');
    if (faltan.length)
      throw new Error(`Configuración insegura: defina valores largos y aleatorios para ${faltan.join(', ')}`);
  }
  const dataDir = path.resolve(RAIZ, e.DATA_DIR);
  return {
    ...e,
    produccion,
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : produccion,
    dataDir,
    uploadsDir: e.UPLOADS_DIR ? path.resolve(RAIZ, e.UPLOADS_DIR) : path.join(dataDir, 'uploads'),
    mailsDir: path.join(dataDir, 'mails'),
    adjuntosPermitidos: e.ADJUNTOS_PERMITIDOS.toLowerCase().split(/[\s,.]+/).filter(Boolean),
    seedDemo: e.SEED_DEMO ? e.SEED_DEMO === 'true' : !produccion,
    portalLogoutUrl: e.PORTAL_LOGOUT_URL || e.PORTAL_URL,
  };
}
export type Config = ReturnType<typeof cargarConfig>;

/** Carga `.env` de la raíz (las variables ya presentes en el entorno tienen prioridad). */
export function cargarDotenv() {
  const archivo = path.join(RAIZ, '.env');
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}
