import { defineConfig, devices } from '@playwright/test';
import { ENTORNO_E2E } from './tests/e2e/entorno.mjs';

// El mismo entorno para el servidor y para los tests (p. ej. para firmar JWT de prueba del portal).
Object.assign(process.env, ENTORNO_E2E);
// Contra un stack externo: su dirección y, para las mediciones que cargan datos, el puerto de su base.
const externo = process.env.E2E_BASE_URL;
if (externo) Object.assign(process.env, { APP_URL: externo, PG_PORT: process.env.E2E_PG_PORT ?? ENTORNO_E2E.PG_PORT });

/**
 * Los proyectos `capturas` y `perf` solo se incluyen si se piden con `--project`. Los procesos worker
 * vuelven a cargar esta configuración sin los argumentos, por eso la selección viaja por el entorno.
 */
const pedidos = process.argv.flatMap((a, i, todos) => {
  if (a.startsWith('--project=')) return [a.slice('--project='.length)];
  return a === '--project' ? [todos[i + 1] ?? ''] : [];
});
if (pedidos.length) process.env.E2E_PROYECTOS = pedidos.join(',');
const opcionales = (process.env.E2E_PROYECTOS ?? '').split(',');

const navegador = { ...devices['Desktop Chrome'], locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' };
const url = externo ?? ENTORNO_E2E.APP_URL!;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...navegador,
    baseURL: url,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'e2e', testIgnore: ['capturas/**', 'perf/**'] },
    ...(opcionales.includes('capturas') ? [{ name: 'capturas', testDir: 'tests/e2e/capturas' }] : []),
    ...(opcionales.includes('perf') ? [{ name: 'perf', testDir: 'tests/e2e/perf', timeout: 300_000, use: { trace: 'off' as const } }] : []),
  ],
  // Con E2E_BASE_URL las pruebas corren contra un stack ya levantado (p. ej. producción detrás de Caddy).
  webServer: externo ? undefined : {
    // Las mediciones se hacen contra el código compilado.
    command: opcionales.includes('perf') ? 'node scripts/dev.mjs --build' : 'node scripts/dev.mjs',
    url: `${url}/api/health`,
    env: { ...ENTORNO_E2E },
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Sin esto Playwright mata el grupo con SIGKILL y Postgres queda sin apagar (en Windows se ignora).
    gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
  },
});
