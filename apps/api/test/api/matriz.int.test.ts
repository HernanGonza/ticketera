/**
 * Matriz de autorización sobre TODAS las rutas registradas. Una ruta nueva debe agregarse a `MATRIZ`
 * y cumplir su rol: sin guarda, la prueba falla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { crearMensaje, registrarAdjunto } from '../../src/db';
import { montarApi, type Api } from './base';

/** P público · K clave del portal · A autenticado · T ticket (ajeno → 404) · S staff · AD admin */
type Nivel = 'P' | 'K' | 'A' | 'T' | 'S' | 'AD';

const MATRIZ: Record<string, Nivel> = {
  'GET /api/health': 'P',
  'GET /auth/portal': 'P',
  'POST /auth/portal': 'P',
  'GET /api/auth/config': 'P',
  'GET /api/auth/altcha': 'P',
  'POST /api/auth/login': 'P',
  'POST /api/auth/dev/token': 'P',
  'POST /api/auth/recuperar': 'P',
  'POST /api/auth/restablecer': 'P',
  'POST /api/auth/refresh': 'P',
  'POST /api/auth/logout': 'P',
  'GET /api/auth/yo': 'A',
  'GET /api/sso/usuario-existe': 'K',
  'GET /api/catalogo': 'A',
  'GET /api/tickets': 'A',
  'POST /api/tickets': 'A',
  'GET /api/tickets/exportar.csv': 'S',
  'POST /api/tickets/masivo': 'S',
  'GET /api/kanban': 'S',
  'GET /api/tickets/:id': 'T',
  'PATCH /api/tickets/:id': 'T',
  'PATCH /api/tickets/:id/mover': 'S',
  'POST /api/tickets/:id/reabrir': 'T',
  'POST /api/tickets/:id/calificar': 'T',
  'GET /api/tickets/:id/mensajes': 'T',
  'POST /api/tickets/:id/mensajes': 'T',
  'PATCH /api/mensajes/:id': 'T',
  'GET /api/tickets/:id/eventos': 'T',
  'POST /api/tickets/:id/lectura': 'T',
  'POST /api/tickets/:id/adjuntos': 'T',
  'GET /api/adjuntos/:id': 'T',
  'GET /api/no-leidos': 'A',
  'GET /api/notificaciones': 'A',
  'POST /api/notificaciones/leer': 'A',
  'GET /api/estadisticas': 'S',
  'POST /api/admin/categorias': 'AD',
  'PUT /api/admin/categorias/orden': 'AD',
  'PUT /api/admin/categorias/:id': 'AD',
  'DELETE /api/admin/categorias/:id': 'AD',
  'POST /api/admin/areas': 'AD',
  'PUT /api/admin/areas/:id': 'AD',
  'GET /api/admin/usuarios': 'AD',
  'POST /api/admin/usuarios': 'AD',
  'PATCH /api/admin/usuarios/:id': 'AD',
  'PUT /api/admin/configuracion': 'AD',
  'POST /api/admin/respuestas': 'S',
  'PUT /api/admin/respuestas/:id': 'S',
  'DELETE /api/admin/respuestas/:id': 'S',
};
/** Rutas del agente realtime-colas: se verifican si están registradas. */
const OPCIONALES: Record<string, Nivel> = {
  'GET /api/admin/colas': 'AD',
  'GET /api/admin/colas/:nombre/trabajos': 'AD',
  'POST /api/admin/colas/:nombre/trabajos/:id/reintentar': 'AD',
  'POST /api/admin/colas/:nombre/trabajos/:id/cancelar': 'AD',
  'GET /dev/mails': 'P',
  'GET /dev/mails/:archivo': 'P',
};
const PUBLICAS_POR_PREFIJO = ['/api/docs'];

let e: Api;
let rutas: { metodo: string; url: string }[] = [];
const ids = { ticket: '', mensaje: '', adjunto: '' };
/** Cuerpos válidos: sin sesión o sin rol la respuesta no debe depender de la entrada. */
const cuerpos = (): Record<string, object> => ({
  'PATCH /api/tickets/:id': { version: 1, prioridad: 'alta' },
  'PATCH /api/tickets/:id/mover': { version: 1, estado: 'cancelado' },
  'POST /api/tickets/:id/reabrir': { version: 1 },
  'POST /api/tickets/:id/calificar': { calificacion: 1 },
  'POST /api/tickets/:id/mensajes': { cuerpo: 'intruso' },
  'PATCH /api/mensajes/:id': { cuerpo: 'intruso' },
  'POST /api/tickets/:id/lectura': { ultimoMensajeId: ids.mensaje },
});

beforeAll(async () => {
  e = await montarApi();
  rutas = e.app.rutasRegistradas.filter(
    (r) => r.metodo !== 'HEAD' && r.metodo !== 'OPTIONS' && !PUBLICAS_POR_PREFIJO.some((p) => r.url.startsWith(p)),
  );
  const duenio = await e.usuario('solicitante');
  ids.ticket = await e.pedido(duenio.id);
  ids.mensaje = (await crearMensaje(e.db, { ticketId: ids.ticket, cuerpo: 'hola' }, duenio)).id;
  ids.adjunto = await registrarAdjunto(
    e.db,
    { ticketId: ids.ticket, ruta: 'x/y.txt', nombre: 'y.txt', mime: 'text/plain', bytes: 1 },
    duenio,
  );
});
afterAll(() => e.cerrarTodo());

const nivel = (r: { metodo: string; url: string }) =>
  MATRIZ[`${r.metodo} ${r.url}`] ?? OPCIONALES[`${r.metodo} ${r.url}`];

function pedido(r: { metodo: string; url: string }): InjectOptions {
  const clave = `${r.metodo} ${r.url}`;
  const id = r.url.startsWith('/api/mensajes')
    ? ids.mensaje
    : r.url.startsWith('/api/adjuntos')
      ? ids.adjunto
      : r.url.startsWith('/api/tickets')
        ? ids.ticket
        : r.url.startsWith('/api/admin/usuarios')
          ? ids.ticket
          : '1';
  const payload = cuerpos()[clave] ?? (r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {});
  return {
    method: r.metodo as InjectOptions['method'] & string,
    url: r.url.replace(':id', id).replace(':nombre', 'sla').replace(':archivo', 'x.html'),
    payload,
  };
}

describe('matriz de autorización', () => {
  it('todas las rutas están declaradas y las propias existen', () => {
    const registradas = rutas.map((r) => `${r.metodo} ${r.url}`);
    expect(registradas.filter((r) => !MATRIZ[r] && !OPCIONALES[r])).toEqual([]);
    expect(Object.keys(MATRIZ).filter((r) => !registradas.includes(r))).toEqual([]);
  });

  it('sin sesión toda ruta protegida responde 401', async () => {
    const mal: string[] = [];
    for (const r of rutas.filter((r) => nivel(r) !== 'P')) {
      const res = await e.app.inject(pedido(r));
      if (res.statusCode !== 401) mal.push(`${r.metodo} ${r.url} → ${res.statusCode}`);
    }
    expect(mal).toEqual([]);
  });

  it('una sesión falsificada o un refresh no sirven como acceso', async () => {
    const mal: string[] = [];
    for (const r of rutas.filter((r) => !['P', 'K'].includes(nivel(r)!))) {
      const res = await e.app.inject({ ...pedido(r), cookies: { eco_sesion: 'falsa', eco_refresh: 'falso' } });
      if (res.statusCode !== 401) mal.push(`${r.metodo} ${r.url} → ${res.statusCode}`);
    }
    expect(mal).toEqual([]);
  });

  it.each([
    ['solicitante de otra área', 'pedro.sosa', ['S', 'AD'], ['T']],
    ['técnico', 'tecnico', ['AD'], []],
  ] as const)('como %s: 403 fuera de su rol y 404 en tickets ajenos', async (_n, alias, prohibidas, ajenas) => {
    const c = await e.ingresar(alias);
    const mal: string[] = [];
    for (const r of rutas) {
      const n = nivel(r) as never;
      const esperado = (prohibidas as readonly string[]).includes(n)
        ? 403
        : (ajenas as readonly string[]).includes(n)
          ? 404
          : null;
      if (!esperado) continue;
      const p = pedido(r);
      // La subida valida el permiso antes de leer el archivo.
      const res = await c.pedir(p);
      if (res.statusCode !== esperado) mal.push(`${r.metodo} ${r.url} → ${res.statusCode} (esperado ${esperado})`);
    }
    expect(mal).toEqual([]);
  });

  it('un compañero de área lee el ticket pero no escribe', async () => {
    const c = await e.ingresar('juan.gonzalez');
    const lectura = ['GET /api/tickets/:id', 'GET /api/tickets/:id/mensajes', 'POST /api/tickets/:id/lectura'];
    for (const r of rutas.filter((r) => nivel(r) === 'T')) {
      const clave = `${r.metodo} ${r.url}`;
      const res = await c.pedir(pedido(r));
      if (lectura.includes(clave) || clave === 'GET /api/tickets/:id/eventos') expect(res.statusCode, clave).toBe(200);
      // El archivo de prueba no está en disco: 404 por el archivo, ya superada la autorización.
      else if (clave === 'GET /api/adjuntos/:id') expect(res.statusCode, clave).toBe(404);
      else expect(res.statusCode, clave).toBe(403);
    }
  });
});
