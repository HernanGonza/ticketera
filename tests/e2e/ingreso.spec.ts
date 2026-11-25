/** Ingreso: respaldo con contraseña y ALTCHA, y Portal del Ministerio con un token de desarrollo. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CLAVE_DEMO, CUENTAS, expect, test } from './apoyo';

const ejecutar = promisify(execFile);

/** La misma herramienta que usa `npm run dev:token`. */
async function urlDevToken(email: string) {
  const { stdout } = await ejecutar(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'apps/api/src/auth/dev-token.ts', '--email', email],
    { env: process.env },
  );
  return stdout.trim().split('\n').at(-1)!;
}

test('ingreso local con contraseña y verificación ALTCHA', async ({ abrir }) => {
  const { page } = await abrir(null, { esperados: [/status of 401 .*\/api\/auth\/login/] });
  await page.goto('/kanban');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  const boton = page.getByRole('button', { name: 'Ingresar', exact: true });
  await expect(page.getByTestId('altcha').getByRole('checkbox')).toBeVisible();
  await expect(boton).toBeDisabled();

  const completar = async (clave: string) => {
    await page.getByLabel('Correo electrónico').fill(CUENTAS.tecnico);
    await page.getByLabel('Contraseña').fill(clave);
    // El foco en el formulario inicia la verificación sola.
    await expect(boton).toBeEnabled({ timeout: 30_000 });
    await boton.click();
  };
  await completar('una-clave-equivocada');
  await expect(page.getByRole('alert')).toBeVisible();
  await completar(CLAVE_DEMO);
  await expect(page).toHaveURL(/\/kanban/);
  await expect(page.getByTestId('menu-usuario')).toBeVisible();

  await page.getByTestId('menu-usuario').click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  // En las pruebas PORTAL_URL apunta al ingreso propio.
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/auth/yo')).status()).toBe(401);
});

test('ingreso por el portal: redirige y quita el token de la dirección', async ({ abrir }) => {
  const { page } = await abrir(null);
  const url = await urlDevToken(CUENTAS.solicitante);
  expect(url).toContain('/auth/portal?token=');
  await page.goto(url);
  await expect(page).toHaveURL(/\/mis-pedidos$/);
  await expect(page.getByRole('heading', { name: 'Mis pedidos', level: 1 })).toBeVisible();
  // El token ya se usó: no sirve por segunda vez.
  await page.context().clearCookies();
  await page.goto(url);
  await expect(page).toHaveURL(/\/login\?error=token_invalido/);
});

for (const [caso, email] of [
  ['un correo que no está en Personal', 'desconocido@example.com'],
  ['un empleado dado de baja', 'baja@ecologia.misiones.gob.ar'],
] as const)
  test(`usuario no habilitado: ${caso}`, async ({ abrir }) => {
    const { page } = await abrir(null);
    await page.goto(await urlDevToken(email));
    await expect(page).toHaveURL(/\/no-habilitado$/);
    await expect(page.getByRole('heading', { name: 'Su usuario no está habilitado' })).toBeVisible();
    await expect(page.getByRole('link', { name: /desarrollo@/ })).toBeVisible();
  });
