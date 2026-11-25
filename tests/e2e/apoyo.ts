/** Utilidades comunes de las pruebas E2E: sesiones, datos por API y vigilancia de errores. */
import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { SignJWT } from 'jose';
import type { Catalogo, TicketDetalle } from '@eco/shared/schemas';

const DOMINIO = 'ecologia.misiones.gob.ar';
export const CUENTAS = {
  admin: `admin@${DOMINIO}`,
  /** Martín Acosta */
  tecnico: `tecnico@${DOMINIO}`,
  tecnica2: `carolina.duarte@${DOMINIO}`,
  /** Área 2 */
  solicitante: `solicitante@${DOMINIO}`,
  /** Área 3: no comparte visibilidad con `solicitante`. */
  ajeno: `pedro.sosa@${DOMINIO}`,
} as const;
export const CLAVE_DEMO = 'Ecologia2024!';
export const MOVIL: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
/** Ancho suficiente para ver las seis columnas del kanban a la vez. */
export const ANCHO: BrowserContextOptions = { viewport: { width: 1920, height: 1000 } };

export const unico = (prefijo: string) => `${prefijo}-${randomUUID().slice(0, 8)}`;
export const urlBase = () => process.env.E2E_BASE_URL ?? process.env.APP_URL!;

export async function tokenPortal(email: string, nombre?: string) {
  const jwt = new SignJWT({ email, nombre })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setJti(randomUUID())
    .setIssuer(process.env.PORTAL_JWT_ISSUER!)
    .setIssuedAt()
    .setExpirationTime('5m');
  return jwt.sign(new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!));
}

/** Abre una sesión propia (cookies en el contexto) entrando por el portal. */
export async function ingresar(contexto: BrowserContext, email: string) {
  const r = await contexto.request.get(`/auth/portal?token=${await tokenPortal(email)}`, { maxRedirects: 0 });
  expect(r.status(), `ingreso de ${email}`).toBe(303);
  expect(r.headers().location).toBe('/');
}

export interface Sesion {
  contexto: BrowserContext;
  page: Page;
  api: Api;
}

export interface OpcionesSesion extends BrowserContextOptions {
  /** Errores de consola que la prueba provoca a propósito. */
  esperados?: RegExp[];
}

/** Respuestas HTTP que el navegador anota en consola y que forman parte del uso normal. */
const NORMALES = [/status of 401 .*\/api\/auth\/(yo|refresh)/];

async function vigilar(page: Page, errores: string[], esperados: RegExp[]) {
  const anotar = (texto: string) => {
    if (![...NORMALES, ...esperados].some((r) => r.test(texto))) errores.push(`${page.url()} → ${texto}`);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') anotar(`${m.text()} ${m.location().url}`);
  });
  page.on('pageerror', (e) => anotar(`excepción: ${e.message}`));
  await page.exposeFunction('__violacionCsp', (d: string) => anotar(`CSP: ${d}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // Zod prueba si puede usar `new Function`; la política lo bloquea y sigue sin él.
      if (e.blockedURI === 'eval') return;
      void (window as unknown as { __violacionCsp(d: string): void }).__violacionCsp(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
}

export class Api {
  private catalogoCache?: Catalogo;
  constructor(readonly request: APIRequestContext) {}

  async pedir<T>(metodo: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, cuerpo?: unknown): Promise<T> {
    const r = await this.request[metodo](url, { data: cuerpo, headers: { origin: new URL(urlBase()).origin } });
    expect(r.ok(), `${metodo.toUpperCase()} ${url} → ${r.status()} ${await r.text()}`).toBe(true);
    return (await r.json()) as T;
  }

  async catalogo(nuevo = false) {
    if (nuevo || !this.catalogoCache) this.catalogoCache = await this.pedir<Catalogo>('get', '/api/catalogo');
    return this.catalogoCache;
  }

  async categoria(nombre: string) {
    const c = (await this.catalogo()).categorias.find((x) => x.nombre === nombre);
    expect(c, `categoría ${nombre}`).toBeTruthy();
    return c!;
  }

  async tecnico(nombre: string) {
    const t = (await this.catalogo()).tecnicos.find((x) => x.nombre === nombre);
    expect(t, `técnico ${nombre}`).toBeTruthy();
    return t!;
  }

  /** Pedido en la categoría «Otro», de asignación manual: nadie lo mueve solo. */
  async crearPedido(titulo: string) {
    const categoria = await this.categoria('Otro');
    return this.pedir<TicketDetalle>('post', '/api/tickets', {
      categoriaId: categoria.id,
      titulo,
      descripcion: 'Pedido generado por una prueba automática.',
      datos: {},
    });
  }

  ticket(ref: string) {
    return this.pedir<TicketDetalle>('get', `/api/tickets/${ref}`);
  }

  /** Cambia estado o asignación respetando la versión vigente. */
  async actualizar(ref: string, cambios: Record<string, unknown>) {
    const t = await this.ticket(ref);
    return this.pedir<TicketDetalle>('patch', `/api/tickets/${t.id}`, { version: t.version, ...cambios });
  }
}

export async function abrirSesion(
  navegador: Browser,
  email: string | null,
  { esperados = [], ...opciones }: OpcionesSesion,
  errores: string[],
): Promise<Sesion> {
  const contexto = await navegador.newContext({
    baseURL: urlBase(),
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    ...opciones,
  });
  if (email) await ingresar(contexto, email);
  const page = await contexto.newPage();
  await vigilar(page, errores, esperados);
  return { contexto, page, api: new Api(contexto.request) };
}

/**
 * `abrir(email)` crea un navegador independiente con sesión (o anónimo con `null`). Al terminar, la
 * prueba falla si alguna página registró errores de consola, excepciones o violaciones de CSP.
 */
export const test = base.extend<{ abrir: (email: string | null, opciones?: OpcionesSesion) => Promise<Sesion> }>({
  abrir: async ({ browser }, usar, info) => {
    const errores: string[] = [];
    const abiertas: Sesion[] = [];
    await usar(async (email, opciones = {}) => {
      const s = await abrirSesion(browser, email, opciones, errores);
      abiertas.push(s);
      return s;
    });
    if (info.status !== info.expectedStatus)
      for (const [i, s] of abiertas.entries())
        await info.attach(`pantalla-${i}`, { body: await s.page.screenshot(), contentType: 'image/png' }).catch(() => {});
    await Promise.all(abiertas.map((s) => s.contexto.close()));
    expect(errores, 'errores de consola, excepciones o violaciones de CSP').toEqual([]);
  },
});
export { expect };

export const conectado = (page: Page) =>
  expect(page.getByTestId('conexion')).toHaveAttribute('data-estado', 'conectado');

export const tarjeta = (page: Page, codigo: string) => page.getByTestId(`tarjeta-${codigo}`);
export const enColumna = (page: Page, estado: string, codigo: string) =>
  page.getByTestId(`columna-${estado}`).getByTestId(`tarjeta-${codigo}`);

/** Abre el kanban filtrado por texto y espera a estar conectado en vivo. */
export async function abrirKanban(page: Page, q: string) {
  await page.goto(`/kanban?q=${encodeURIComponent(q)}`);
  await expect(page.getByTestId('columna-nuevo')).toBeVisible();
  await conectado(page);
}

/**
 * Arrastre real con el puntero. La tarjeta se toma por su franja inferior (sin enlaces ni botones) y se
 * suelta en el destino indicado: otra tarjeta, un avatar o la parte libre de una columna.
 */
export async function arrastrar(page: Page, origen: Locator, destino: Locator, punto: 'centro' | 'abajo' = 'centro') {
  await origen.scrollIntoViewIfNeeded();
  const a = (await origen.boundingBox())!;
  const desde = { x: a.x + a.width / 2, y: a.y + a.height - 8 };
  await page.mouse.move(desde.x, desde.y);
  await page.mouse.down();
  await page.mouse.move(desde.x + 8, desde.y + 8, { steps: 4 });
  // El asa indica que el arrastre empezó.
  await expect(origen).toHaveClass(/opacity-40/);
  const b = (await destino.boundingBox())!;
  const hasta = { x: b.x + b.width / 2, y: punto === 'abajo' ? b.y + b.height - 60 : b.y + b.height / 2 };
  await page.mouse.move(hasta.x, hasta.y, { steps: 20 });
  await page.mouse.move(hasta.x + 1, hasta.y + 1, { steps: 2 });
  await page.mouse.up();
}

/** PNG válido de 64×48 para adjuntos. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZUlEQVR4nO3PQQ0AIBDAsFOGB3zg/40IHg3JkgnoZp39dcMFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBGiLEph2kCMQAAAAASUVORK5CYII=',
  'base64',
);
