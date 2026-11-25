/** Recorrido principal entre dos navegadores: alta desde el celular, arrastre y chat en vivo. */
import { ANCHO, abrirKanban, arrastrar, conectado, CUENTAS, enColumna, expect, MOVIL, test, unico } from './apoyo';

test('(a) un pedido creado desde el celular aparece sin recargar en el kanban del técnico', async ({ abrir }) => {
  const titulo = unico('Pantalla azul al encender');
  const tecnico = await abrir(CUENTAS.tecnico, ANCHO);
  await abrirKanban(tecnico.page, titulo);
  await expect(tecnico.page.getByTestId('columna-nuevo').getByText('Sin tickets')).toBeVisible();
  await tecnico.page.evaluate(() => Object.assign(window, { sinRecarga: true }));

  const celular = await abrir(CUENTAS.solicitante, MOVIL);
  const otro = await celular.api.categoria('Otro');
  await celular.page.goto('/nuevo');
  await celular.page.getByTestId(`categoria-${otro.id}`).tap();
  await celular.page.getByLabel('Título').fill(titulo);
  await celular.page.getByLabel('Descripción', { exact: false }).first().fill('La computadora muestra una pantalla azul.');
  await celular.page.getByLabel('Ubicación o interno').fill('Interno 214');
  await celular.page.getByRole('button', { name: 'Enviar pedido' }).tap();
  const codigo = (await celular.page.getByTestId('codigo-confirmacion').textContent())!.trim();
  expect(codigo).toMatch(/^TCK-\d{4}-\d{6}$/);

  await expect(enColumna(tecnico.page, 'nuevo', codigo)).toContainText(titulo);
  expect(await tecnico.page.evaluate(() => 'sinRecarga' in window)).toBe(true);
});

test('(b) el técnico arrastra a «En curso» y el solicitante lo ve en vivo', async ({ abrir }) => {
  const titulo = unico('Impresora sin respuesta');
  const solicitante = await abrir(CUENTAS.solicitante, MOVIL);
  const { codigo, id } = await solicitante.api.crearPedido(titulo);
  await solicitante.page.goto(`/tickets/${codigo}`);
  await expect(solicitante.page.getByTestId('estado-ticket')).toHaveAttribute('data-estado', 'nuevo');
  // La presencia del técnico confirmará más abajo que ambos están en la sala del pedido.
  await conectado(solicitante.page);

  const tecnico = await abrir(CUENTAS.tecnico, ANCHO);
  await abrirKanban(tecnico.page, titulo);
  await arrastrar(tecnico.page, enColumna(tecnico.page, 'nuevo', codigo), tecnico.page.getByTestId('columna-en_curso'), 'abajo');

  await expect(enColumna(tecnico.page, 'en_curso', codigo)).toBeVisible();
  await expect(solicitante.page.getByTestId('estado-ticket')).toHaveAttribute('data-estado', 'en_curso');
  const t = await tecnico.api.ticket(id);
  expect(t.estado).toBe('en_curso');
  expect(t.asignado?.nombre).toBe('Martín Acosta');
});

test('(c) chat en vivo en ambos sentidos con «está escribiendo»', async ({ abrir }) => {
  const solicitante = await abrir(CUENTAS.solicitante, MOVIL);
  const { codigo } = await solicitante.api.crearPedido(unico('Sin acceso a la carpeta compartida'));
  const tecnico = await abrir(CUENTAS.tecnico, ANCHO);
  await tecnico.page.goto(`/tickets/${codigo}`);
  await solicitante.page.goto(`/tickets/${codigo}`);
  // Verse mutuamente implica que los dos sockets ya están en la sala.
  await expect(tecnico.page.getByTestId('presencia')).toBeVisible();
  await expect(solicitante.page.getByTestId('presencia')).toBeVisible();

  const pares = [
    { de: solicitante.page, a: tecnico.page, nombre: 'Sofía Fernández', texto: unico('Hola, sigue sin abrir') },
    { de: tecnico.page, a: solicitante.page, nombre: 'Martín Acosta', texto: unico('Ya lo estamos revisando') },
  ];
  for (const { de, a, nombre, texto } of pares) {
    await de.getByTestId('chat-entrada').pressSequentially(texto);
    await expect(a.getByTestId('escribiendo')).toContainText(`${nombre} está escribiendo`);
    await de.getByTestId('chat-enviar').click();
    await expect(a.getByTestId('mensaje').filter({ hasText: texto })).toBeVisible();
    await expect(a.getByTestId('escribiendo')).toBeHidden();
    await expect(de.getByTestId('mensaje').filter({ hasText: texto })).toHaveCount(1);
  }
});
