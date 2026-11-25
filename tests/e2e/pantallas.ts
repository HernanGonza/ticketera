/** Inventario de pantallas (spec §7), compartido por la revisión de accesibilidad y las capturas. */
import type { Page } from '@playwright/test';
import { CUENTAS, expect, PNG, type Sesion } from './apoyo';

export interface Datos {
  /** Pedido en curso con conversación, nota interna y adjunto. */
  enCurso: string;
  /** Pedido resuelto, pendiente de calificación. */
  resuelto: string;
}

export interface Pantalla {
  nombre: string;
  cuenta: string | null;
  /** También se captura en un teléfono. */
  movil?: boolean;
  /** También se captura en modo oscuro. */
  oscuro?: boolean;
  /** Diálogos y menús: la captura es de lo visible, no de la página entera. */
  soloVisible?: boolean;
  /** Respuestas HTTP de error que la pantalla provoca. */
  esperados?: RegExp[];
  ir: (page: Page, datos: Datos) => Promise<void>;
}

export async function prepararDatos(tecnico: Sesion, solicitante: Sesion): Promise<Datos> {
  const red = await solicitante.api.categoria('Wi-Fi');
  const campos = Object.fromEntries(
    red.campos.filter((c) => c.requerido).map((c) => [c.clave, c.tipo === 'seleccion' ? c.opciones![0]! : 'Oficina 12']),
  );
  const enCurso = await solicitante.api.pedir<{ id: string; codigo: string }>('post', '/api/tickets', {
    categoriaId: red.id,
    titulo: 'Sin conexión Wi-Fi en la sala de reuniones',
    descripcion: 'Desde esta mañana las notebooks no logran conectarse a la red de la sala del primer piso.',
    ubicacion: 'Primer piso, interno 214',
    datos: campos,
  });
  const adjunto = await solicitante.contexto.request.post(`/api/tickets/${enCurso.id}/adjuntos`, {
    multipart: { archivo: { name: 'mensaje-de-error.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(adjunto.status()).toBe(201);
  // La categoría tiene asignación automática: se espera al worker para no competir por la versión.
  await expect.poll(async () => (await tecnico.api.ticket(enCurso.id)).estado).toBe('asignado');
  const yo = await tecnico.api.tecnico('Martín Acosta');
  await tecnico.api.actualizar(enCurso.id, { asignadoId: yo.id });
  await tecnico.api.actualizar(enCurso.id, { estado: 'en_curso' });
  const mensaje = (s: Sesion, cuerpo: string, interno = false) =>
    s.api.pedir('post', `/api/tickets/${enCurso.id}/mensajes`, { cuerpo, interno });
  await mensaje(tecnico, 'Buenos días. Estamos revisando el punto de acceso. ¿Le ocurre en todos los equipos?');
  await mensaje(solicitante, 'Sí, en las tres notebooks que probamos.');
  await mensaje(tecnico, 'El equipo del primer piso quedó sin configuración tras el corte de luz.', true);
  await mensaje(tecnico, 'Gracias. En unos minutos lo reiniciamos y le avisamos.');

  const resuelto = await solicitante.api.crearPedido('Alta de casilla de correo institucional');
  await tecnico.api.actualizar(resuelto.id, { estado: 'en_curso' });
  await tecnico.api.actualizar(resuelto.id, { estado: 'resuelto' });
  return { enCurso: enCurso.codigo, resuelto: resuelto.codigo };
}

/** Espera a que no queden indicadores de carga ni fuentes pendientes. */
export async function asentada(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Cargando' })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Cargando' })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Las imágenes de adjuntos ya decodificadas.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
}

const ruta = (url: string, titulo: string | RegExp) => async (page: Page) => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: titulo }).first()).toBeVisible();
};

export const PANTALLAS: Pantalla[] = [
  {
    nombre: 'login',
    cuenta: null,
    movil: true,
    oscuro: true,
    ir: async (page) => {
      await ruta('/login', 'Mesa de soporte técnico')(page);
      await expect(page.getByTestId('altcha').getByRole('checkbox')).toBeVisible();
    },
  },
  { nombre: 'no-habilitado', cuenta: null, movil: true, ir: ruta('/no-habilitado', 'Su usuario no está habilitado') },
  { nombre: 'recuperar-contrasena', cuenta: null, ir: ruta('/recuperar', 'Recuperar contraseña') },
  { nombre: 'restablecer-contrasena', cuenta: null, ir: ruta('/restablecer?token=ejemplo', 'Definir nueva contraseña') },
  { nombre: 'nuevo-categorias', cuenta: CUENTAS.solicitante, movil: true, ir: ruta('/nuevo', 'Nuevo pedido') },
  {
    nombre: 'nuevo-formulario',
    cuenta: CUENTAS.solicitante,
    movil: true,
    ir: async (page) => {
      await ruta('/nuevo', 'Nuevo pedido')(page);
      await page.getByRole('button', { name: /Internet/ }).click();
      await expect(page.getByLabel('Título')).toBeVisible();
    },
  },
  {
    nombre: 'nuevo-confirmacion',
    cuenta: CUENTAS.solicitante,
    movil: true,
    ir: async (page) => {
      await ruta('/nuevo', 'Nuevo pedido')(page);
      await page.getByRole('button', { name: /^Otro/ }).click();
      await page.getByLabel('Título').fill('Solicitud de segundo monitor');
      await page.getByLabel('Descripción', { exact: false }).first().fill('Para trabajar con dos planillas a la vez.');
      await page.getByRole('button', { name: 'Enviar pedido' }).click();
      await expect(page.getByTestId('codigo-confirmacion')).toBeVisible();
    },
  },
  { nombre: 'mis-pedidos', cuenta: CUENTAS.solicitante, movil: true, ir: ruta('/mis-pedidos', 'Mis pedidos') },
  {
    nombre: 'pedido-detalle',
    cuenta: CUENTAS.solicitante,
    movil: true,
    ir: async (page, d) => {
      await ruta(`/tickets/${d.enCurso}`, /Sin conexión Wi-Fi/)(page);
      await expect(page.getByTestId('mensaje').first()).toBeVisible();
    },
  },
  {
    nombre: 'pedido-calificacion',
    cuenta: CUENTAS.solicitante,
    movil: true,
    ir: async (page, d) => {
      await ruta(`/tickets/${d.resuelto}?calificar=1`, /Alta de casilla/)(page);
      await expect(page.getByText('¿Cómo fue la atención?')).toBeVisible();
    },
  },
  {
    nombre: 'kanban',
    cuenta: CUENTAS.tecnico,
    oscuro: true,
    ir: async (page) => {
      await page.goto('/kanban');
      await expect(page.locator('[data-testid^="tarjeta-"]').first()).toBeVisible();
    },
  },
  {
    nombre: 'lista',
    cuenta: CUENTAS.tecnico,
    ir: async (page) => {
      await ruta('/lista', 'Lista de tickets')(page);
      await expect(page.locator('[data-testid^="fila-TCK"]').first()).toBeVisible();
    },
  },
  {
    nombre: 'ticket-tecnico',
    cuenta: CUENTAS.tecnico,
    ir: async (page, d) => {
      await ruta(`/tickets/${d.enCurso}`, /Sin conexión Wi-Fi/)(page);
      await expect(page.getByTestId('gestion-estado')).toBeVisible();
      await expect(page.getByTestId('mensaje').first()).toBeVisible();
    },
  },
  {
    nombre: 'tablero',
    cuenta: CUENTAS.tecnico,
    ir: async (page) => {
      await ruta('/tablero', 'Estadísticas')(page);
      await expect(page.getByTestId('kpis')).toBeVisible();
      for (const id of ['semanal', 'backlog', 'areas', 'categorias', 'calor'])
        await expect(page.getByTestId(`grafico-${id}`).locator('canvas, svg, table').first()).toBeAttached();
    },
  },
  { nombre: 'admin-categorias', cuenta: CUENTAS.admin, ir: ruta('/admin/categorias', 'Categorías') },
  {
    nombre: 'admin-categoria-editor',
    soloVisible: true,
    cuenta: CUENTAS.admin,
    ir: async (page) => {
      await ruta('/admin/categorias', 'Categorías')(page);
      await page.getByRole('listitem').filter({ hasText: 'Internet' }).getByRole('button', { name: 'Editar' }).click();
      await expect(page.getByRole('dialog').getByTestId('vista-previa')).toBeVisible();
    },
  },
  {
    nombre: 'admin-usuarios',
    cuenta: CUENTAS.admin,
    ir: async (page) => {
      await ruta('/admin/usuarios', 'Usuarios')(page);
      await expect(page.getByText(CUENTAS.tecnico).first()).toBeVisible();
    },
  },
  { nombre: 'admin-areas', cuenta: CUENTAS.admin, ir: ruta('/admin/areas', 'Áreas') },
  { nombre: 'admin-configuracion', cuenta: CUENTAS.admin, ir: ruta('/admin/configuracion', 'Configuración') },
  {
    nombre: 'admin-colas',
    cuenta: CUENTAS.admin,
    ir: async (page) => {
      await ruta('/admin/colas', 'Colas de trabajo')(page);
      await page.getByTestId('cola-notificaciones-mail').getByRole('button').first().click();
      await expect(page.getByRole('region', { name: /Trabajos de/ })).toBeVisible();
    },
  },
  {
    nombre: 'notificaciones',
    soloVisible: true,
    cuenta: CUENTAS.solicitante,
    movil: true,
    ir: async (page) => {
      await ruta('/mis-pedidos', 'Mis pedidos')(page);
      await page.getByRole('button', { name: /^Notificaciones/ }).click();
      await expect(page.getByRole('dialog').or(page.getByRole('menu')).first()).toBeVisible();
    },
  },
  {
    nombre: 'preferencias',
    soloVisible: true,
    cuenta: CUENTAS.solicitante,
    movil: true,
    ir: async (page) => {
      await ruta('/mis-pedidos', 'Mis pedidos')(page);
      await page.getByTestId('menu-usuario').click();
      await page.getByRole('menuitem', { name: 'Preferencias' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
];

export const enOscuro = (sesion: Sesion) =>
  sesion.contexto.addInitScript(() => localStorage.setItem('eco.preferencias', JSON.stringify({ tema: 'oscuro' })));
