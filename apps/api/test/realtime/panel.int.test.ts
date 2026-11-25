/** Panel de colas y visor de correos, sobre la aplicación completa. */
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLAS } from '@eco/shared/colas';
import type { UsuarioSesion } from '@eco/shared/dominio';
import type { ResumenCola, Trabajo } from '@eco/shared/schemas';
import { crearApp } from '../../src/app';
import { COOKIE_SESION, firmarSesion } from '../../src/auth/sesion';
import { montar, type Entorno } from '../db/base';
import { configPrueba } from './apoyo';

let e: Entorno;
let datos: string;
let admin: UsuarioSesion;
let tecnico: UsuarioSesion;
let sofia: UsuarioSesion;
let boss: PgBoss | undefined;

const nuevaApp = async (extra: Record<string, string> = {}) => {
  const app = await crearApp({ config: configPrueba(e.url, { DATA_DIR: datos, ...extra }), conexion: e });
  await app.ready();
  return app;
};
let app: Awaited<ReturnType<typeof nuevaApp>>;

beforeAll(async () => {
  e = await montar();
  datos = mkdtempSync(path.join(tmpdir(), 'eco-panel-'));
  [admin, tecnico, sofia] = [await e.usuario('admin'), await e.usuario('tecnico'), await e.usuario('solicitante')];
  app = await nuevaApp();
});
afterAll(async () => {
  await boss?.stop({ graceful: false, close: true });
  await app?.close();
  await e?.desmontar();
  rmSync(datos, { recursive: true, force: true });
});

async function pedir(url: string, u?: UsuarioSesion, method: 'GET' | 'POST' = 'GET') {
  const cookies: Record<string, string> = u
    ? { [COOKIE_SESION]: await firmarSesion(u, app.deps.config.SESSION_SECRET) }
    : {};
  return app.inject({ url, method, cookies });
}
const ID = '00000000-0000-4000-8000-000000000000';

describe('panel de colas', () => {
  it('solo para administradores', async () => {
    const rutas = [
      ['GET', '/api/admin/colas'],
      ['GET', `/api/admin/colas/${COLAS.mail}/trabajos`],
      ['POST', `/api/admin/colas/${COLAS.mail}/trabajos/${ID}/reintentar`],
      ['POST', `/api/admin/colas/${COLAS.mail}/trabajos/${ID}/cancelar`],
      // La autorización se resuelve antes de validar la entrada.
      ['GET', `/api/admin/colas/x/trabajos?limite=-1`],
    ] as const;
    for (const [metodo, url] of rutas) {
      expect((await pedir(url, undefined, metodo)).statusCode, url).toBe(401);
      expect((await pedir(url, tecnico, metodo)).statusCode, url).toBe(403);
      expect((await pedir(url, sofia, metodo)).statusCode, url).toBe(403);
    }
  });

  it('funciona antes de que exista el esquema de pg-boss', async () => {
    const r = await pedir('/api/admin/colas', admin);
    expect(r.statusCode).toBe(200);
    const items = r.json<{ items: ResumenCola[] }>().items;
    expect(items.map((c) => c.nombre)).toEqual(Object.values(COLAS));
    expect(items.every((c) => c.pendientes + c.fallidos + c.completados === 0)).toBe(true);
    expect((await pedir(`/api/admin/colas/${COLAS.mail}/trabajos`, admin)).json()).toEqual({ items: [] });
    expect((await pedir(`/api/admin/colas/${COLAS.mail}/trabajos/${ID}/cancelar`, admin, 'POST')).statusCode).toBe(404);
  });

  it('lista sin datos sensibles, reintenta y cancela', async () => {
    boss = new PgBoss({ connectionString: e.url, max: 2, schedule: false, supervise: false });
    await boss.start();
    await boss.createQueue(COLAS.mail, { retryLimit: 0 });
    const fallido = (await boss.send(COLAS.mail, { clase: 'x', token: 'MUY-SECRETO' }))!;
    await boss.fetch(COLAS.mail);
    await boss.fail(COLAS.mail, fallido, new Error('rechazado para alguien@dominio.test token=MUY-SECRETO'));
    const pendiente = (await boss.send(COLAS.mail, { clase: 'y' }, { startAfter: 3600 }))!;

    const resumen = (await pedir('/api/admin/colas', admin)).json<{ items: ResumenCola[] }>().items;
    expect(resumen.find((c) => c.nombre === COLAS.mail)).toMatchObject({ pendientes: 1, fallidos: 1 });

    const lista = await pedir(`/api/admin/colas/${COLAS.mail}/trabajos?estado=failed`, admin);
    expect(lista.statusCode).toBe(200);
    expect(lista.body).not.toContain('MUY-SECRETO');
    expect(lista.body).not.toContain('alguien@dominio.test');
    expect(lista.json<{ items: Trabajo[] }>().items).toMatchObject([{ id: fallido, estado: 'failed' }]);

    const ruta = (id: string, accion: string) => `/api/admin/colas/${COLAS.mail}/trabajos/${id}/${accion}`;
    const estado = async (id: string) => (await boss!.findJobs(COLAS.mail, { id }))[0]!.state;
    expect((await pedir(ruta(pendiente, 'reintentar'), admin, 'POST')).statusCode).toBe(409);
    expect((await pedir(ruta(fallido, 'reintentar'), admin, 'POST')).json()).toEqual({ ok: true });
    expect(await estado(fallido)).toBe('retry');
    expect((await pedir(ruta(pendiente, 'cancelar'), admin, 'POST')).statusCode).toBe(200);
    expect(await estado(pendiente)).toBe('cancelled');
    expect((await pedir(ruta(pendiente, 'reintentar'), admin, 'POST')).statusCode).toBe(200);
    expect(await estado(pendiente)).toBe('created');
    expect((await pedir(ruta(ID, 'cancelar'), admin, 'POST')).statusCode).toBe(404);
  });

  it('valida el nombre de la cola, el id y los filtros', async () => {
    expect((await pedir('/api/admin/colas/otra/trabajos', admin)).statusCode).toBe(404);
    expect((await pedir(`/api/admin/colas/${COLAS.mail}/trabajos?limite=999`, admin)).statusCode).toBe(400);
    expect((await pedir(`/api/admin/colas/${COLAS.mail}/trabajos/1/cancelar`, admin, 'POST')).statusCode).toBe(400);
  });
});

describe('/dev/mails', () => {
  it('lista y muestra los correos sin salir de la carpeta', async () => {
    const carpeta = app.deps.config.mailsDir;
    await mkdir(carpeta, { recursive: true });
    await writeFile(path.join(carpeta, '20260101-000000-000_a@b.test_hola.html'), '<p>Hola</p>');
    await writeFile(path.join(datos, 'secreto.html'), 'NO');
    const lista = await pedir('/dev/mails');
    expect(lista.statusCode).toBe(200);
    expect(lista.body).toContain('hola.html');
    const uno = await pedir('/dev/mails/20260101-000000-000_a%40b.test_hola.html');
    expect(uno.body).toBe('<p>Hola</p>');
    expect(uno.headers['content-security-policy']).toContain("default-src 'none'");
    for (const malo of ['..%2Fsecreto.html', '%2E%2E%2Fsecreto.html', '..%5Csecreto.html', 'no-existe.html', '.env']) {
      const r = await pedir(`/dev/mails/${malo}`);
      expect(r.statusCode, malo).toBe(404);
      expect(r.body).not.toBe('NO');
    }
  });

  it('no existe en producción', async () => {
    const prod = await nuevaApp({
      NODE_ENV: 'production',
      APP_URL: 'https://eco.prueba',
      SESSION_SECRET: 's'.repeat(40),
      ALTCHA_HMAC_KEY: 'a'.repeat(40),
    });
    try {
      expect((await prod.inject('/dev/mails')).statusCode).toBe(404);
      expect((await prod.inject('/dev/mails/x.html')).statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});
