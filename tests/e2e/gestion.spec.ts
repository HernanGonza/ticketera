/** Administración, colas, estadísticas en vivo y correos. */
import type { Page } from '@playwright/test';
import { conectado, CUENTAS, expect, test, unico } from './apoyo';

test('el administrador crea una categoría con un campo extra y el solicitante la usa', async ({ abrir }) => {
  const admin = await abrir(CUENTAS.admin);
  const nombre = unico('Notebook en préstamo');
  await admin.page.goto('/admin/categorias');
  await admin.page.getByRole('button', { name: 'Nueva categoría' }).click();
  const dialogo = admin.page.getByRole('dialog');
  await dialogo.getByLabel('Nombre').fill(nombre);
  await dialogo.getByRole('button', { name: 'Agregar campo' }).click();
  await dialogo.getByLabel('Etiqueta del campo 1').fill('Fecha en que la necesita');
  await dialogo.getByLabel('Tipo').selectOption('fecha');
  await dialogo.getByLabel('Obligatorio').check();
  await expect(dialogo.getByTestId('vista-previa')).toContainText('Fecha en que la necesita');
  await dialogo.getByRole('button', { name: 'Guardar categoría' }).click();
  await expect(dialogo).toBeHidden();
  await expect(admin.page.getByText(nombre)).toBeVisible();

  const solicitante = await abrir(CUENTAS.solicitante);
  const { page } = solicitante;
  await page.goto('/nuevo');
  await page.getByRole('button', { name: nombre }).click();
  await page.getByLabel('Título').fill(`Pedido de ${nombre}`);
  await page.getByLabel('Descripción', { exact: false }).first().fill('La necesito para una capacitación.');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByText('Este campo es obligatorio').or(page.getByRole('alert')).first()).toBeVisible();
  await page.getByLabel('Fecha en que la necesita').fill('2030-03-15');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await page.getByRole('link', { name: 'Ver el pedido' }).click();
  await expect(page.getByRole('definition').filter({ hasText: '15/03/2030' })).toBeVisible();
});

test('el panel de colas muestra los trabajos procesados', async ({ abrir }) => {
  const admin = await abrir(CUENTAS.admin);
  await admin.api.crearPedido(unico('Pedido para la cola de correos'));
  const { page } = admin;
  await page.goto('/admin/colas');
  const fila = page.getByTestId('cola-notificaciones-mail');
  await expect(fila).toBeVisible();
  // Columnas: pendientes, activos, completados, fallidos, cancelados. El panel se refresca solo.
  await expect.poll(async () => Number(await fila.getByRole('cell').nth(2).textContent()), { timeout: 30_000 }).toBeGreaterThan(0);
  await fila.getByRole('button', { name: 'notificaciones-mail' }).click();
  await expect(page.getByRole('region', { name: 'Trabajos de notificaciones-mail' })).toContainText('Completado');
});

const indicador = async (page: Page, titulo: string) =>
  Number(await page.getByTestId('kpis').getByRole('listitem').filter({ hasText: titulo }).locator('span').last().textContent());

test('el tablero de estadísticas se actualiza en vivo', async ({ abrir }) => {
  const tecnico = await abrir(CUENTAS.tecnico);
  const solicitante = await abrir(CUENTAS.solicitante);
  const { page } = tecnico;
  await page.goto('/tablero');
  await expect(page.getByTestId('kpis')).toBeVisible();
  await expect(page.getByTestId('grafico-semanal').locator('canvas, svg').first()).toBeVisible();
  await conectado(page);
  const antes = { abiertos: await indicador(page, 'Abiertos'), hoy: await indicador(page, 'Creados hoy') };
  await page.evaluate(() => Object.assign(window, { sinRecarga: true }));
  await solicitante.api.crearPedido(unico('Pedido que mueve el tablero'));
  await expect.poll(() => indicador(page, 'Creados hoy')).toBeGreaterThan(antes.hoy);
  await expect.poll(() => indicador(page, 'Abiertos')).toBeGreaterThan(antes.abiertos);
  expect(await page.evaluate(() => 'sinRecarga' in window)).toBe(true);
});

test('el alta de un pedido genera el correo, visible en /dev/mails', async ({ abrir }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'El visor de correos no existe en producción.');
  const { page, api } = await abrir(CUENTAS.solicitante);
  const titulo = unico('Pedido con correo');
  const { codigo } = await api.crearPedido(titulo);
  const enlace = page.getByRole('link', { name: new RegExp(`${CUENTAS.solicitante}.*${codigo}`) });
  await expect(async () => {
    await page.goto('/dev/mails');
    await expect(enlace.first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await enlace.first().click();
  await expect(page.getByText(titulo).first()).toBeVisible();
  await expect(page.getByText(codigo).first()).toBeVisible();
});
