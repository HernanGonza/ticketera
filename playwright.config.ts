import { defineConfig, devices } from '@playwright/test';
import { ENTORNO_E2E } from './tests/e2e/entorno.mjs';

// El mismo entorno para el servidor y para los tests (p. ej. para firmar JWT de prueba del portal).
Object.assign(process.env, ENTORNO_E2E);

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
const url = ENTORNO_E2E.APP_URL!;

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
    ...(opcionales.includes('perf') ? [{ name: 'perf', testDir: 'tests/e2e/perf', timeout: 180_000 }] : []),
  ],
  webServer: {
    command: 'node scripts/dev.mjs',
    url: `${url}/api/health`,
    env: { ...ENTORNO_E2E },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Sin esto Playwright mata el grupo con SIGKILL y Postgres queda sin apagar (en Windows se ignora).
    gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
  },
});
