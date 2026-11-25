/** Adjuntos (selector y Ctrl+V), calificación y reapertura. */
import type { Page } from '@playwright/test';
import { CUENTAS, expect, PNG, test, unico } from './apoyo';

/** Copia una imagen al portapapeles real del navegador y la pega con el teclado. */
async function pegarImagen(page: Page) {
  await page.evaluate(async () => {
    const lienzo = new OffscreenCanvas(40, 30);
    const c = lienzo.getContext('2d')!;
    c.fillRect(0, 0, 40, 30);
    const blob = await lienzo.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.keyboard.press('ControlOrMeta+V');
}

test('adjuntos elegidos y pegados con Ctrl+V, en el alta y en el chat', async ({ abrir }) => {
  const { page, api } = await abrir(CUENTAS.solicitante, { permissions: ['clipboard-read', 'clipboard-write'] });
  const otro = await api.categoria('Otro');
  await page.goto(`/nuevo?categoria=${otro.id}`);
  const titulo = unico('Error al abrir el sistema');
  await page.getByLabel('Título').fill(titulo);
  await page.getByLabel('Descripción', { exact: false }).first().fill('Adjunto capturas del error.');
  await page
    .getByLabel('Adjuntar archivos', { exact: true })
    .setInputFiles({ name: 'foto-del-error.png', mimeType: 'image/png', buffer: PNG });
  const lista = page.getByRole('list', { name: 'Archivos para adjuntar' });
  await expect(lista.getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Título').focus();
  await pegarImagen(page);
  await expect(lista.getByRole('listitem')).toHaveCount(2);
  await expect(lista).toContainText('captura-');

  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByTestId('codigo-confirmacion')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('link', { name: 'Ver el pedido' }).click();
  await expect(page.getByRole('button', { name: 'Ver foto-del-error.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ver captura-/ })).toBeVisible();

  await page.getByTestId('chat-entrada').focus();
  await pegarImagen(page);
  await page.getByTestId('chat-entrada').fill('Va otra captura');
  await page.getByTestId('chat-enviar').click();
  const mensaje = page.getByTestId('mensaje').filter({ hasText: 'Va otra captura' });
  const imagen = mensaje.getByRole('img', { name: /captura-/ });
  await expect(imagen).toBeVisible();
  await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40);

  await mensaje.getByRole('button', { name: /^Ver captura-/ }).click();
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
});

test('al resolverse, el solicitante califica la atención', async ({ abrir }) => {
  const solicitante = await abrir(CUENTAS.solicitante);
  const tecnico = await abrir(CUENTAS.tecnico);
  const { id, codigo } = await solicitante.api.crearPedido(unico('Alta de correo'));
  await tecnico.api.actualizar(id, { estado: 'en_curso' });
  const { page } = solicitante;
  await page.goto(`/tickets/${codigo}`);
  await expect(page.getByTestId('estado-ticket')).toHaveAttribute('data-estado', 'en_curso');
  await tecnico.api.actualizar(id, { estado: 'resuelto' });
  await expect(page.getByTestId('estado-ticket')).toHaveAttribute('data-estado', 'resuelto');

  await page.locator('label').filter({ hasText: '5 de 5' }).click();
  await page.getByLabel('Comentario (opcional)').fill('Muy rápida la respuesta.');
  await page.getByRole('button', { name: 'Enviar calificación' }).click();
  await expect(page.getByRole('img', { name: '5 de 5' })).toBeVisible();
  expect((await solicitante.api.ticket(id)).calificacion).toBe(5);
});

test('un pedido resuelto se puede reabrir', async ({ abrir }) => {
  const solicitante = await abrir(CUENTAS.solicitante);
  const tecnico = await abrir(CUENTAS.tecnico);
  const { id, codigo } = await solicitante.api.crearPedido(unico('Wi-Fi intermitente'));
  await tecnico.api.actualizar(id, { estado: 'en_curso' });
  await tecnico.api.actualizar(id, { estado: 'resuelto' });
  const { page } = solicitante;
  await page.goto(`/tickets/${codigo}`);
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await page.getByLabel('Motivo (opcional)').fill('Volvió a cortarse.');
  await page.getByRole('button', { name: 'Reabrir pedido' }).click();
  await expect(page.getByTestId('estado-ticket')).toHaveAttribute('data-estado', 'en_curso');
  const t = await solicitante.api.ticket(id);
  expect(t.reabierto).toBe(1);
});

test('mis pedidos se agrupan por estado y el pedido cambia de sección en vivo', async ({ abrir }) => {
  const solicitante = await abrir(CUENTAS.solicitante);
  const tecnico = await abrir(CUENTAS.tecnico);
  const { id, codigo } = await solicitante.api.crearPedido(unico('Teclado sin respuesta'));
  const { page } = solicitante;
  await page.goto('/mis-pedidos');
  const tarjeta = (estado: string) => page.getByTestId(`seccion-${estado}`).getByTestId(`tarjeta-${codigo}`);
  await expect(tarjeta('nuevo')).toBeVisible();
  await tecnico.api.actualizar(id, { estado: 'en_curso' });
  await expect(tarjeta('en_curso')).toBeVisible();
  await expect(tarjeta('nuevo')).toHaveCount(0);
  await expect(page.getByTestId('seccion-cerrado').getByRole('button', { name: /^Cerrados/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
