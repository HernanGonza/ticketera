// Entorno del stack aislado de las pruebas E2E. Lo usan playwright.config.ts y scripts/e2e.mjs.
// Todo se define explícitamente (aun vacío) para que un `.env` local no se filtre en las pruebas:
// las variables ya presentes tienen prioridad sobre el archivo.
const WEB = 'http://localhost:5174';

export const ENTORNO_E2E = Object.freeze({
  NODE_ENV: 'development',
  DATA_DIR: '.data-e2e',
  PG_PORT: '5435',
  API_HOST: '127.0.0.1',
  API_PORT: '3101',
  WEB_PORT: '5174',
  APP_URL: WEB,
  DATABASE_URL: '',
  UPLOADS_DIR: '',
  LOG_LEVEL: 'warn',
  TRUST_PROXY: '',
  COOKIE_SECURE: 'false',
  SESSION_SECRET: 'e2e-session-secret-de-prueba-0123456789abcdef',
  ALTCHA_HMAC_KEY: 'e2e-altcha-hmac-key-de-prueba-0123456789abcdef',
  ALTCHA_COSTO: '50',
  LOGIN_MAX_INTENTOS: '10000',
  PORTAL_URL: `${WEB}/login`,
  PORTAL_LOGOUT_URL: '',
  PORTAL_JWT_ALG: 'HS256',
  PORTAL_JWT_SECRET: 'e2e-portal-jwt-secret-de-prueba-0123456789abcdef',
  PORTAL_JWT_PUBLIC_KEY: '',
  PORTAL_JWT_JWKS_URL: '',
  PORTAL_JWT_ISSUER: 'portal.ecologia.misiones.gob.ar',
  PORTAL_JWT_AUDIENCE: '',
  PORTAL_API_KEY: 'e2e-portal-api-key-de-prueba-0123456789',
  PERSONAL_DATABASE_URL: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SEED_DEMO: 'true',
  ADMIN_EMAIL: '',
  ADMIN_PASSWORD: '',
});
