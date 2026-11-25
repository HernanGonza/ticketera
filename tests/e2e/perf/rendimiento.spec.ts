/**
 * Mediciones de rendimiento sobre el código compilado (`npm run e2e:perf`). Escribe los números en
 * test-results/rendimiento.json; docs/PERFORMANCE.md resume método, resultados y limitaciones.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import type { BrowserContext, Page } from '@playwright/test';
import { abrirKanban, ANCHO, conectado, CUENTAS, enColumna, expect, test, unico, type Sesion } from '../apoyo';
import { asentada, PANTALLAS, prepararDatos } from '../pantallas';

const resultados: Record<string, unknown> = {};
const anotar = (clave: string, valor: unknown) => {
  resultados[clave] = valor;
  console.log(clave, JSON.stringify(valor));
};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(path.join('test-results', `rendimiento-${Date.now()}.json`), JSON.stringify(resultados, null, 2));
});

const percentil = (v: number[], p: number) => {
  const o = [...v].sort((a, b) => a - b);
  return Math.round(o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)]!);
};
const resumen = (v: number[]) => ({
  muestras: v.length,
  mediana: percentil(v, 50),
  p95: percentil(v, 95),
  min: Math.round(Math.min(...v)),
  max: Math.round(Math.max(...v)),
});

test('JavaScript transferido por pantalla', async ({ abrir }) => {
  const datos = await prepararDatos(await abrir(CUENTAS.tecnico), await abrir(CUENTAS.solicitante));
  const pesos = new Map<string, number>();
  const gzip = (ruta: string) => {
    if (!pesos.has(ruta)) pesos.set(ruta, gzipSync(readFileSync(path.join('apps/web/dist', ruta)), { level: 9 }).length);
    return pesos.get(ruta)!;
  };
  const filas: Record<string, { archivos: number; kbGzip: number }> = {};
  for (const p of PANTALLAS) {
    const sesion = await abrir(p.cuenta, { viewport: { width: 1440, height: 900 }, esperados: p.esperados });
    const pedidos = new Set<string>();
    sesion.page.on('request', (r) => {
      const ruta = new URL(r.url()).pathname;
      if (ruta.endsWith('.js')) pedidos.add(ruta);
    });
    await p.ir(sesion.page, datos);
    await asentada(sesion.page);
    const total = [...pedidos].reduce((a, r) => a + gzip(r), 0);
    filas[p.nombre] = { archivos: pedidos.size, kbGzip: Number((total / 1024).toFixed(1)) };
    await sesion.contexto.close();
  }
  anotar('jsPorPantalla', filas);
});

interface Carga {
  lcp: number;
  contenido: number;
}

/** Carga en frío (contexto nuevo, sin caché). `limitado`: red de 10 Mb/s y 40 ms, CPU 4 veces más lenta. */
async function cargar(sesion: Sesion, url: string, listo: string, limitado: boolean): Promise<Carga> {
  const { page, contexto } = sesion;
  if (limitado) {
    const cdp = await contexto.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 40,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (5 * 1024 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript((selector) => {
    const m = ((window as unknown as { __carga: Carga }).__carga = { lcp: 0, contenido: 0 });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) m.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    const mirar = () => {
      if (document.querySelector(selector)) requestAnimationFrame(() => (m.contenido = performance.now()));
      else requestAnimationFrame(mirar);
    };
    requestAnimationFrame(mirar);
  }, listo);
  await page.goto(url);
  const leer = () => page.evaluate(() => (window as unknown as { __carga: Carga }).__carga);
  await expect.poll(async () => (await leer()).contenido, { timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  return leer();
}

async function medirCargas(abrir: (email: string | null) => Promise<Sesion>, etiqueta: string) {
  for (const limitado of [false, true])
    for (const [nombre, cuenta, url, listo] of [
      ['login', null, '/login', '[data-testid="altcha"]'],
      ['kanban', CUENTAS.tecnico, '/kanban', '[data-testid^="tarjeta-"]'],
    ] as const) {
      const muestras: Carga[] = [];
      for (let i = 0; i < 7; i++) {
        const sesion = await abrir(cuenta);
        muestras.push(await cargar(sesion, url, listo, limitado));
        await sesion.contexto.close();
      }
      anotar(`carga.${nombre}.${etiqueta}.${limitado ? 'limitada' : 'local'}`, {
        lcpMs: resumen(muestras.map((m) => m.lcp)),
        contenidoMs: resumen(muestras.map((m) => m.contenido)),
      });
    }
}

test('LCP de ingreso y kanban con los datos de demostración', async ({ abrir }) => {
  await medirCargas(abrir, 'demo');
});

/** Instante (reloj de la máquina, ms) en que aparece algo en una página. */
const alAparecer = (page: Page, selector: string, texto: string | null) =>
  page.evaluate(
    ([s, t]) =>
      new Promise<number>((ok) => {
        const hay = () => [...document.querySelectorAll(s!)].some((n) => !t || n.textContent!.includes(t));
        const marcar = () => {
          if (!hay()) return false;
          ok(performance.timeOrigin + performance.now());
          return true;
        };
        if (marcar()) return;
        const o = new MutationObserver(() => marcar() && o.disconnect());
        o.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      }),
    [selector, texto] as const,
  );
/** Instante del próximo evento del usuario en la página que actúa. */
const alEvento = (contexto: Page, tipo: 'click' | 'keydown' | 'change' | 'pointerup') =>
  contexto.evaluate(
    (t) =>
      new Promise<number>((ok) =>
        window.addEventListener(t, (e) => ok(performance.timeOrigin + e.timeStamp), { capture: true, once: true }),
      ),
    tipo,
  );

test('latencia de una mutación en un navegador hasta verse en otro', async ({ abrir }) => {
  const solicitante = await abrir(CUENTAS.solicitante);
  const tecnico = await abrir(CUENTAS.tecnico, ANCHO);
  const titulo = unico('Latencia');
  const { codigo, id } = await solicitante.api.crearPedido(titulo);
  await tecnico.page.goto(`/tickets/${codigo}`);
  await solicitante.page.goto(`/tickets/${codigo}`);
  await expect(tecnico.page.getByTestId('presencia')).toBeVisible();
  await expect(solicitante.page.getByTestId('presencia')).toBeVisible();

  // Mensaje de chat: Enter del técnico → burbuja en el navegador del solicitante.
  const chat: number[] = [];
  for (let i = 0; i < 30; i++) {
    const texto = unico(`muestra-${i}`);
    await tecnico.page.getByTestId('chat-entrada').fill(texto);
    const visto = alAparecer(solicitante.page, '[data-testid="mensaje"]', texto);
    const enviado = alEvento(tecnico.page, 'keydown');
    await tecnico.page.getByTestId('chat-entrada').press('Enter');
    chat.push((await visto) - (await enviado));
    await expect(tecnico.page.getByTestId('chat-entrada')).toHaveValue('');
  }
  anotar('latencia.chatMs', resumen(chat));

  // Cambio de estado: selección del técnico → estado en la pantalla del solicitante.
  await tecnico.api.actualizar(id, { estado: 'en_curso' });
  await expect(tecnico.page.getByTestId('gestion-estado')).toHaveValue('en_curso');
  const estado: number[] = [];
  for (let i = 0; i < 30; i++) {
    const destino = i % 2 ? 'en_curso' : 'en_espera';
    const visto = alAparecer(solicitante.page, `[data-testid="estado-ticket"][data-estado="${destino}"]`, null);
    const cambiado = alEvento(tecnico.page, 'change');
    await tecnico.page.getByTestId('gestion-estado').selectOption(destino);
    estado.push((await visto) - (await cambiado));
    await expect(tecnico.page.getByTestId('gestion-estado')).toBeEnabled();
    await expect.poll(async () => (await tecnico.api.ticket(id)).estado).toBe(destino);
    await expect(tecnico.page.getByTestId('estado-ticket')).toHaveAttribute('data-estado', destino);
  }
  anotar('latencia.estadoMs', resumen(estado));

  // Arrastre en el tablero: soltar → tarjeta en la columna nueva del tablero de otra persona.
  const otro = await abrir(CUENTAS.tecnica2, ANCHO);
  await abrirKanban(tecnico.page, titulo);
  await abrirKanban(otro.page, titulo);
  const tablero: number[] = [];
  let actual = (await tecnico.api.ticket(id)).estado;
  for (let i = 0; i < 20; i++) {
    const destino = actual === 'en_curso' ? 'en_espera' : 'en_curso';
    const origen = enColumna(tecnico.page, actual, codigo);
    const caja = (await origen.boundingBox())!;
    await tecnico.page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height - 8);
    await tecnico.page.mouse.down();
    await tecnico.page.mouse.move(caja.x + caja.width / 2 + 10, caja.y + caja.height, { steps: 4 });
    const columna = (await tecnico.page.getByTestId(`columna-${destino}`).boundingBox())!;
    await tecnico.page.mouse.move(columna.x + columna.width / 2, columna.y + columna.height - 60, { steps: 10 });
    const visto = alAparecer(otro.page, `[data-testid="columna-${destino}"] [data-testid="tarjeta-${codigo}"]`, null);
    const soltado = alEvento(tecnico.page, 'pointerup');
    await tecnico.page.mouse.up();
    tablero.push((await visto) - (await soltado));
    await expect.poll(async () => (await tecnico.api.ticket(id)).estado).toBe(destino);
    await expect(enColumna(tecnico.page, destino, codigo)).toBeVisible();
    actual = destino;
  }
  anotar('latencia.arrastreMs', resumen(tablero));
});

/** Cuadros dibujados mientras se arrastra una tarjeta de un lado a otro del tablero. */
async function medirArrastre(contexto: BrowserContext, page: Page, lento: number) {
  const cdp = await contexto.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: lento });
  const primera = page.getByTestId('columna-nuevo').locator('[data-testid^="tarjeta-"]').first();
  const caja = (await primera.boundingBox())!;
  const x0 = caja.x + caja.width / 2;
  const y0 = caja.y + caja.height - 8;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 10, y0 + 10, { steps: 4 });
  await expect(primera).toHaveClass(/opacity-40/);
  await page.evaluate(() => {
    const m = ((window as unknown as { __cuadros: { t: number[]; seguir: boolean } }).__cuadros = {
      t: [] as number[],
      seguir: true,
    });
    const cuadro = (t: number) => {
      m.t.push(t);
      if (m.seguir) requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  });
  await cdp.send('Performance.enable');
  const ocupacion = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')!.value;
  const antes = await ocupacion();
  const inicio = Date.now();
  let i = 0;
  while (Date.now() - inicio < 6000) {
    const fase = (i++ % 160) / 160;
    const ida = fase < 0.5 ? fase * 2 : 2 - fase * 2;
    await page.mouse.move(x0 + ida * 1400, y0 + Math.sin(fase * Math.PI * 4) * 200);
  }
  const tiempos = await page.evaluate(() => {
    const m = (window as unknown as { __cuadros: { t: number[]; seguir: boolean } }).__cuadros;
    m.seguir = false;
    return m.t;
  });
  const ocupado = (await ocupacion()) - antes;
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const intervalos = tiempos.slice(1).map((t, j) => t - tiempos[j]!);
  const total = tiempos.at(-1)! - tiempos[0]!;
  return {
    cpu: `${lento}x`,
    movimientos: i,
    hiloPrincipalOcupado: `${Math.round((ocupado * 100) / ((Date.now() - inicio) / 1000))} %`,
    segundos: Number((total / 1000).toFixed(1)),
    fpsPromedio: Number(((intervalos.length * 1000) / total).toFixed(1)),
    cuadroMs: {
      mediana: Number([...intervalos].sort((a, b) => a - b)[Math.floor(intervalos.length / 2)]!.toFixed(1)),
      p95: percentil(intervalos, 95),
      max: Math.round(Math.max(...intervalos)),
    },
    cuadrosDeMasDe50ms: intervalos.filter((v) => v > 50).length,
  };
}

test('con 500 pedidos abiertos más: carga y fluidez del arrastre', async ({ abrir }) => {
  await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/api/src/db/cli.ts', 'perf', '500'], {
    env: { ...process.env, DATABASE_URL: `postgres://eco:eco@127.0.0.1:${process.env.PG_PORT}/ecosoporte` },
  });
  const { contexto, page, api } = await abrir(CUENTAS.tecnico, ANCHO);
  const kanban = await api.pedir<unknown>('get', '/api/kanban');
  const respuesta = await contexto.request.get('/api/kanban');
  await page.goto('/kanban');
  await expect(page.locator('[data-testid^="tarjeta-"]').first()).toBeVisible();
  await conectado(page);
  await asentada(page);
  anotar('kanban500', {
    tarjetasDeLaApi: (JSON.stringify(kanban).match(/"codigo":"TCK-/g) ?? []).length,
    kbRespuestaSinComprimir: Math.round((await respuesta.body()).length / 1024),
    tarjetasEnElDom: await page.locator('[data-testid^="tarjeta-"]').count(),
  });
  for (const lento of [1, 4]) anotar(`arrastre.cpu${lento}x`, await medirArrastre(contexto, page, lento));
  await medirCargas(abrir, 'con500');
});
