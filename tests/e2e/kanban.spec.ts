/** Tablero: conflicto de versiones, orden, asignación por arrastre y uso con teclado. */
import type { Page } from '@playwright/test';
import { ANCHO, abrirKanban, arrastrar, CUENTAS, enColumna, expect, tarjeta, test, unico } from './apoyo';

/** Códigos de una columna en el orden en que se ven. */
const orden = (page: Page, estado: string) =>
  page.getByTestId(`columna-${estado}`).locator('[data-testid^="tarjeta-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => ({ codigo: n.getAttribute('data-testid')!.slice('tarjeta-'.length), y: n.getBoundingClientRect().y }))
      .sort((a, b) => a.y - b.y)
      .map((n) => n.codigo),
  );

test('(d) el segundo técnico, con una versión vieja, recibe el aviso y queda en el estado correcto', async ({ abrir }) => {
  const titulo = unico('Teléfono sin tono');
  const primero = await abrir(CUENTAS.tecnico, ANCHO);
  const { codigo, id } = await primero.api.crearPedido(titulo);
  await primero.api.actualizar(id, { estado: 'en_curso' });

  // 409 es la respuesta esperada para el segundo.
  const segundo = await abrir(CUENTAS.tecnica2, { ...ANCHO, esperados: [/status of 409/] });
  // El segundo navegador deja de recibir eventos (solo pasan los latidos): su copia queda vieja.
  let cortado = false;
  let mejorado!: () => void;
  const enWebSocket = new Promise<void>((ok) => (mejorado = ok));
  await segundo.contexto.routeWebSocket(/\/socket\.io\//, (cliente) => {
    const servidor = cliente.connectToServer();
    cliente.onMessage((m) => {
      if (m === '5') mejorado();
      servidor.send(m);
    });
    servidor.onMessage((m) => {
      if (!cortado || m === '2') cliente.send(m);
    });
  });
  await abrirKanban(primero.page, titulo);
  await abrirKanban(segundo.page, titulo);
  await enWebSocket;
  await expect(enColumna(segundo.page, 'en_curso', codigo)).toBeVisible();
  cortado = true;

  await arrastrar(primero.page, enColumna(primero.page, 'en_curso', codigo), primero.page.getByTestId('columna-en_espera'), 'abajo');
  await expect.poll(async () => (await primero.api.ticket(id)).estado).toBe('en_espera');
  await expect(enColumna(segundo.page, 'en_curso', codigo)).toBeVisible();

  await arrastrar(segundo.page, enColumna(segundo.page, 'en_curso', codigo), segundo.page.getByTestId('columna-resuelto'), 'abajo');

  await expect(segundo.page.getByText('Otro técnico modificó este ticket')).toBeVisible();
  await expect(enColumna(segundo.page, 'en_espera', codigo)).toBeVisible();
  await expect(enColumna(segundo.page, 'resuelto', codigo)).toHaveCount(0);
  expect((await primero.api.ticket(id)).estado).toBe('en_espera');
});

test('reordenar dentro de una columna se conserva al recargar', async ({ abrir }) => {
  const grupo = unico('Orden');
  const { page, api } = await abrir(CUENTAS.tecnico, ANCHO);
  const codigos: string[] = [];
  for (const n of [1, 2, 3]) codigos.push((await api.crearPedido(`${grupo} pedido ${n}`)).codigo);
  await abrirKanban(page, grupo);
  await expect.poll(() => orden(page, 'nuevo')).toHaveLength(3);
  const inicial = await orden(page, 'nuevo');
  const [a, b, c] = inicial as [string, string, string];

  // La última sobre la primera: queda delante.
  const guardado = page.waitForResponse((r) => r.url().endsWith('/mover') && r.request().method() === 'PATCH');
  await arrastrar(page, tarjeta(page, c), tarjeta(page, a));
  expect((await guardado).ok()).toBe(true);
  await expect.poll(() => orden(page, 'nuevo')).toEqual([c, a, b]);

  await page.reload();
  await expect.poll(() => orden(page, 'nuevo')).toEqual([c, a, b]);
  expect(new Set(codigos)).toEqual(new Set(inicial));
});

test('soltar sobre un avatar asigna el pedido', async ({ abrir }) => {
  const titulo = unico('Proyector sin imagen');
  const { page, api } = await abrir(CUENTAS.tecnico, ANCHO);
  const { codigo, id } = await api.crearPedido(titulo);
  const diego = await api.tecnico('Diego Ramírez');
  await abrirKanban(page, titulo);
  await arrastrar(page, tarjeta(page, codigo), page.getByTestId(`avatar-tecnico-${diego.id}`));
  await expect.poll(async () => (await api.ticket(id)).asignado?.nombre).toBe('Diego Ramírez');
  await expect(tarjeta(page, codigo).getByTitle('Diego Ramírez').or(tarjeta(page, codigo).getByText('DR'))).toBeVisible();
});

test('el tablero se puede operar solo con el teclado', async ({ abrir }) => {
  const titulo = unico('Cámara desconectada');
  const { page, api } = await abrir(CUENTAS.tecnico, ANCHO);
  const { codigo, id } = await api.crearPedido(titulo);
  await abrirKanban(page, titulo);
  const asa = page.getByRole('button', { name: `Mover ${codigo}` });
  await asa.focus();
  await page.keyboard.press('Space');
  const anuncio = page.locator('[id^="DndLiveRegion"]');
  await expect(anuncio).toContainText(codigo);
  await expect(tarjeta(page, codigo).first()).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(anuncio).toContainText('Asignado');
  await page.keyboard.press('Space');
  await expect(enColumna(page, 'asignado', codigo)).toBeVisible();
  await expect.poll(async () => (await api.ticket(id)).estado).toBe('asignado');
});
