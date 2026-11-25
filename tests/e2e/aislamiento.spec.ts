/** (e) Un solicitante no accede a pedidos ajenos, ni por la interfaz, la API o el tiempo real. */
import { io, type Socket } from 'socket.io-client';
import type { EventosCliente, EventosServidor } from '@eco/shared/realtime';
import type { Mensaje } from '@eco/shared/schemas';
import { CUENTAS, expect, PNG, test, unico, urlBase, type Sesion } from './apoyo';

type Cliente = Socket<EventosServidor, EventosCliente>;

async function conectarSocket({ contexto }: Sesion): Promise<Cliente> {
  const cookies = await contexto.cookies();
  const socket: Cliente = io(urlBase(), {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      origin: new URL(urlBase()).origin,
    },
  });
  await new Promise<void>((ok, mal) => {
    socket.once('connect', () => ok());
    socket.once('connect_error', mal);
  });
  return socket;
}
const unirse = (s: Cliente, sala: string) => s.timeout(5000).emitWithAck('sala:unirse', { sala });

test('un solicitante no ve pedidos ajenos en la interfaz ni en la API', async ({ abrir }) => {
  const dueno = await abrir(CUENTAS.solicitante);
  const titulo = unico('Pedido reservado');
  const t = await dueno.api.crearPedido(titulo);
  const adjunto = await dueno.contexto.request.post(`/api/tickets/${t.id}/adjuntos`, {
    multipart: { archivo: { name: 'reservado.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(adjunto.status()).toBe(201);
  const { id: adjuntoId } = (await adjunto.json()) as { id: string };

  const ajeno = await abrir(CUENTAS.ajeno, { esperados: [/status of 404/] });
  for (const url of [
    `/api/tickets/${t.id}`,
    `/api/tickets/${t.codigo}`,
    `/api/tickets/${t.id}/mensajes`,
    `/api/tickets/${t.id}/eventos`,
    `/api/adjuntos/${adjuntoId}`,
  ])
    expect((await ajeno.contexto.request.get(url)).status(), url).toBe(404);
  const escribir = await ajeno.contexto.request.post(`/api/tickets/${t.id}/mensajes`, { data: { cuerpo: 'intruso' } });
  expect(escribir.status()).toBe(404);
  for (const url of ['/api/kanban', '/api/estadisticas', '/api/admin/colas'])
    expect((await ajeno.contexto.request.get(url)).status(), url).toBe(403);
  const lista = await ajeno.contexto.request.get(`/api/tickets?ambito=todos&q=${encodeURIComponent(titulo)}`);
  expect(await lista.text()).not.toContain(titulo);

  await ajeno.page.goto(`/tickets/${t.codigo}`);
  await expect(ajeno.page.getByRole('heading', { name: 'No encontramos lo que busca' })).toBeVisible();
  await expect(ajeno.page.getByText(titulo)).toHaveCount(0);
  await ajeno.page.goto('/kanban');
  await expect(ajeno.page).toHaveURL(/\/mis-pedidos/);
});

test('las salas ajenas se rechazan y las notas internas no llegan al solicitante', async ({ abrir }) => {
  const dueno = await abrir(CUENTAS.solicitante);
  const propio = await dueno.api.crearPedido(unico('Pedido con nota interna'));
  const ajeno = await abrir(CUENTAS.ajeno);
  const tecnico = await abrir(CUENTAS.tecnico);

  const intruso = await conectarSocket(ajeno);
  const solicitante = await conectarSocket(dueno);
  try {
    for (const sala of ['tecnicos', 'tablero', `ticket:${propio.id}`, `ticket:${propio.id}:interno`, 'usuario:otro'])
      expect(await unirse(intruso, sala), sala).toEqual({ ok: false });
    for (const sala of ['tecnicos', 'tablero', `ticket:${propio.id}:interno`])
      expect(await unirse(solicitante, sala), sala).toEqual({ ok: false });
    expect(await unirse(solicitante, `ticket:${propio.id}`)).toEqual({ ok: true });

    const recibidos: string[] = [];
    const delIntruso: unknown[] = [];
    intruso.onAny((...datos) => delIntruso.push(datos));
    solicitante.on('mensaje:nuevo', ({ mensaje }) => recibidos.push(mensaje.cuerpo));

    await dueno.page.goto(`/tickets/${propio.codigo}`);
    const nota = unico('Nota solo para Soporte');
    const publico = unico('Respuesta visible');
    for (const [cuerpo, interno] of [
      [nota, true],
      [publico, false],
    ] as const)
      await tecnico.api.pedir<Mensaje>('post', `/api/tickets/${propio.id}/mensajes`, { cuerpo, interno });

    // El publicador respeta el orden: al llegar el público, la nota ya se habría entregado.
    await expect.poll(() => recibidos).toContain(publico);
    expect(recibidos).not.toContain(nota);
    await expect(dueno.page.getByText(publico)).toBeVisible();
    await expect(dueno.page.getByText(nota)).toHaveCount(0);
    const mensajes = await dueno.contexto.request.get(`/api/tickets/${propio.id}/mensajes`);
    expect(await mensajes.text()).not.toContain(nota);
    expect(JSON.stringify(delIntruso)).not.toContain(propio.id);
  } finally {
    intruso.disconnect();
    solicitante.disconnect();
  }
});
