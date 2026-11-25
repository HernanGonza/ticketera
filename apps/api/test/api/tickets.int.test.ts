import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  zCatalogo,
  zEstadisticas,
  zKanban,
  zListaNotificaciones,
  zMensaje,
  zNoLeidos,
  zPaginaTickets,
  zPaginaUsuarios,
  zTicketDetalle,
} from '@eco/shared/schemas';
import { actualizarTicket, crearNotificaciones } from '../../src/db';
import { celdaCsv } from '../../src/rutas/csv';
import { correo, montarApi, type Api } from './base';

let e: Api;
type Cliente = ReturnType<Api['cliente']>;
let sol: Cliente, colega: Cliente, tec: Cliente, admin: Cliente;
let categoriaId: number;

beforeAll(async () => {
  e = await montarApi();
  [sol, colega, tec, admin] = (await Promise.all(
    ['solicitante', 'juan.gonzalez', 'tecnico', 'admin'].map((a) => e.ingresar(a)),
  )) as [Cliente, Cliente, Cliente, Cliente];
  categoriaId = (await e.categoria('Otro')).id;
});
afterAll(() => e.cerrarTodo());

const crear = async (c = sol, titulo = 'No anda la impresora') => {
  const r = await c.post('/api/tickets', { categoriaId, titulo, descripcion: 'No imprime desde hoy' });
  expect(r.statusCode, r.body).toBe(201);
  return zTicketDetalle.parse(r.json());
};

describe('ciclo de un pedido', () => {
  it('crea, consulta por código, lista y muestra en el kanban', async () => {
    const t = await crear();
    expect(t).toMatchObject({ estado: 'nuevo', version: 1 });
    expect((await sol.get(`/api/tickets/${t.codigo.toLowerCase()}`)).json().id).toBe(t.id);
    const mios = zPaginaTickets.parse((await sol.get('/api/tickets?estado=nuevo,asignado&q=impresora')).json());
    expect(mios.items.map((x) => x.id)).toContain(t.id);
    expect((await colega.get('/api/tickets?ambito=mios')).json().total).toBe(0);
    expect((await colega.get('/api/tickets?ambito=area')).json().total).toBeGreaterThan(0);
    const kanban = zKanban.parse((await tec.get('/api/kanban')).json());
    expect(kanban.tickets.map((x) => x.id)).toContain(t.id);
    expect((await e.outbox()).some((o) => o.tipo === 'ticket.creado')).toBe(true);
  });

  it('valida la entrada', async () => {
    const r = await sol.post('/api/tickets', { categoriaId, titulo: 'x', descripcion: '' });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().detalles.campos)).toEqual(['titulo', 'descripcion']);
    expect((await sol.get('/api/tickets?porPagina=9999')).statusCode).toBe(400);
    expect((await sol.get('/api/tickets/no-es-un-id')).statusCode).toBe(404);
    expect((await sol.get('/api/adjuntos/no-es-un-id')).statusCode).toBe(400);
    expect((await admin.put('/api/admin/areas/abc', { nombre: 'Algo' })).statusCode).toBe(400);
  });

  it('con la visibilidad por área apagada, el compañero deja de ver', async () => {
    const t = await crear();
    const config = zCatalogo.parse((await admin.get('/api/catalogo')).json()).configuracion;
    await admin.put('/api/admin/configuracion', { ...config, solicitanteVeArea: false });
    expect((await colega.get(`/api/tickets/${t.id}`)).statusCode).toBe(404);
    await admin.put('/api/admin/configuracion', config);
    expect((await colega.get(`/api/tickets/${t.id}`)).statusCode).toBe(200);
  });

  it('detecta conflictos de versión al actualizar y mover', async () => {
    const t = await crear();
    const ok = await tec.patch(`/api/tickets/${t.id}`, { version: 1, prioridad: 'alta' });
    expect(ok.json()).toMatchObject({ prioridad: 'alta', version: 2 });
    const viejo = await admin.patch(`/api/tickets/${t.id}`, { version: 1, prioridad: 'baja' });
    expect(viejo.statusCode).toBe(409);
    expect(viejo.json()).toMatchObject({
      error: 'conflicto_version',
      detalles: { ticket: { id: t.id, version: 2, prioridad: 'alta' } },
    });
    const mover = await tec.patch(`/api/tickets/${t.id}/mover`, { version: 1, estado: 'en_curso' });
    expect(mover.json().error).toBe('conflicto_version');
    const bien = await tec.patch(`/api/tickets/${t.id}/mover`, { version: 2, estado: 'en_curso' });
    expect(bien.json()).toMatchObject({ estado: 'en_curso', version: 3, asignado: { nombre: expect.any(String) } });
    const invalida = await tec.patch(`/api/tickets/${t.id}/mover`, { version: 3, estado: 'cerrado' });
    expect(invalida.json().error).toBe('transicion_invalida');
  });

  it('ordena dentro de una columna', async () => {
    const a = await crear();
    const b = await crear();
    const r = await tec.patch(`/api/tickets/${b.id}/mover`, { version: 1, estado: 'nuevo', despuesDeId: a.id });
    expect(r.json().ordenKanban).toBeGreaterThan(a.ordenKanban);
  });

  it('el solicitante no gestiona y resuelve, reabre y califica según las reglas', async () => {
    const t = await crear();
    expect((await sol.patch(`/api/tickets/${t.id}`, { version: 1, prioridad: 'critica' })).statusCode).toBe(403);
    expect((await sol.patch(`/api/tickets/${t.id}/mover`, { version: 1, estado: 'cancelado' })).statusCode).toBe(403);
    expect((await sol.post(`/api/tickets/${t.id}/reabrir`, { version: 1 })).json().error).toBe('transicion_invalida');
    await tec.patch(`/api/tickets/${t.id}`, { version: 1, estado: 'en_curso' });
    const resuelto = (await tec.patch(`/api/tickets/${t.id}`, { version: 2, estado: 'resuelto' })).json();
    expect((await sol.post(`/api/tickets/${t.id}/reabrir`, { version: 1 })).json().error).toBe('conflicto_version');
    const re = await sol.post(`/api/tickets/${t.id}/reabrir`, { version: resuelto.version, motivo: 'Sigue igual' });
    expect(re.json()).toMatchObject({ estado: 'en_curso', reabierto: 1 });
    expect((await sol.post(`/api/tickets/${t.id}/calificar`, { calificacion: 5 })).statusCode).toBe(409);
    await tec.patch(`/api/tickets/${t.id}`, { version: re.json().version, estado: 'resuelto' });
    expect((await tec.post(`/api/tickets/${t.id}/calificar`, { calificacion: 5 })).statusCode).toBe(403);
    expect((await sol.post(`/api/tickets/${t.id}/calificar`, { calificacion: 6 })).statusCode).toBe(400);
    const c = await sol.post(`/api/tickets/${t.id}/calificar`, { calificacion: 4, comentario: 'Bien' });
    expect(c.json()).toMatchObject({ calificacion: 4, comentarioCalificacion: 'Bien' });
  });

  it('las notas internas no existen para solicitantes', async () => {
    const t = await crear();
    const url = `/api/tickets/${t.id}/mensajes`;
    expect((await sol.post(url, { cuerpo: 'nota', interno: true })).statusCode).toBe(403);
    const publico = zMensaje.parse((await tec.post(url, { cuerpo: 'Lo vemos', clienteId: 'c1' })).json());
    expect((await tec.post(url, { cuerpo: 'Lo vemos', clienteId: 'c1' })).json().id).toBe(publico.id);
    const nota = (await tec.post(url, { cuerpo: 'SECRETO', interno: true })).json();
    for (const c of [sol, colega]) {
      expect((await c.get(url)).json().items.map((m: { id: string }) => m.id)).toEqual([publico.id]);
      for (const ruta of [url, `/api/tickets/${t.id}`, `/api/tickets/${t.id}/eventos`, '/api/tickets?ambito=area'])
        expect((await c.get(ruta)).body).not.toContain('SECRETO');
      expect((await c.post(`/api/tickets/${t.id}/lectura`, { ultimoMensajeId: nota.id })).statusCode).toBe(404);
    }
    expect((await sol.patch(`/api/mensajes/${nota.id}`, { cuerpo: 'x' })).statusCode).toBe(404);
    expect((await tec.get(url)).json().items).toHaveLength(2);
    expect((await admin.patch(`/api/mensajes/${publico.id}`, { cuerpo: 'x' })).statusCode).toBe(403);
    expect((await tec.patch(`/api/mensajes/${publico.id}`, { cuerpo: 'Editado' })).json()).toMatchObject({
      cuerpo: 'Editado',
      editadoAt: expect.any(String),
    });
    const noLeidos = zNoLeidos.parse((await sol.get('/api/no-leidos')).json());
    expect(noLeidos.porTicket[t.id]).toBe(1);
    await sol.post(`/api/tickets/${t.id}/lectura`, { ultimoMensajeId: publico.id });
    expect((await sol.get('/api/no-leidos')).json().porTicket[t.id]).toBeUndefined();
  });

  it('los avisos de SLA solo se ven en el historial del staff', async () => {
    const t = await crear();
    await e.db.execute(
      sql`insert into ticket_eventos (ticket_id, tipo, a) values (${t.id}, 'sla_vencido', 'respuesta')`,
    );
    const tipos = async (c: Cliente) =>
      (await c.get(`/api/tickets/${t.id}/eventos`)).json().items.map((x: { tipo: string }) => x.tipo);
    expect(await tipos(sol)).toEqual(['creado']);
    expect(await tipos(tec)).toEqual(['creado', 'sla_vencido']);
  });

  it('aplica acciones masivas informando los errores', async () => {
    const a = await crear();
    const b = await crear();
    await actualizarTicket(e.db, b.id, { estado: 'cancelado' }, null);
    const r = await tec.post('/api/tickets/masivo', {
      ids: [a.id, b.id, crypto.randomUUID()],
      cambios: { estado: 'en_curso' },
    });
    expect(r.json().actualizados).toEqual([a.id]);
    expect(r.json().errores).toHaveLength(2);
  });

  it('exporta CSV con BOM, punto y coma y sin fórmulas ejecutables', async () => {
    await crear(sol, '=HYPERLINK("http://malo";"clic")');
    await crear(sol, 'Comillas " y ; en el título');
    const r = await tec.get('/api/tickets/exportar.csv?ambito=todos');
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.body.startsWith('﻿"Código";"Título"')).toBe(true);
    expect(r.body).toContain(`"'=HYPERLINK(""http://malo"";""clic"")"`);
    expect(r.body).toContain('"Comillas "" y ; en el título"');
    expect(r.body).toMatch(/"\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}"/);
    for (const v of ['=1', '+1', '-1', '@x', '  =1', '\t1', '\r1', '\n=1', '＝1'])
      expect(celdaCsv(v)).toBe(`"'${v}"`);
    expect(celdaCsv('normal = 1')).toBe('"normal = 1"');
  });
});

describe('catálogo, notificaciones, estadísticas y administración', () => {
  const nueva = {
    nombre: 'Escáner',
    icono: 'printer',
    prioridadDefault: 'media',
    slaRespuestaMin: 60,
    slaResolucionMin: 600,
  };

  it('administra categorías y oculta las inactivas', async () => {
    const c = (await admin.post('/api/admin/categorias', nueva)).json();
    expect(c).toMatchObject({ nombre: 'Escáner', activa: true });
    expect((await admin.post('/api/admin/categorias', nueva)).json().error).toBe('conflicto');
    const m = await admin.put(`/api/admin/categorias/${c.id}`, { ...nueva, descripcion: 'Escaneo' });
    expect(m.json().descripcion).toBe('Escaneo');
    expect((await admin.put('/api/admin/categorias/orden', { ids: [c.id] })).json()).toEqual({ ok: true });
    expect((await admin.borrar(`/api/admin/categorias/${c.id}`)).json().activa).toBe(false);
    const ids = async (x: Cliente) =>
      (await x.get('/api/catalogo')).json().categorias.map((y: { id: number }) => y.id);
    expect(await ids(admin)).toContain(c.id);
    expect(await ids(tec)).not.toContain(c.id);
    expect((await sol.get('/api/catalogo')).json()).toMatchObject({ tecnicos: [], respuestasRapidas: [] });
    expect((await admin.put('/api/admin/categorias/99999', nueva)).statusCode).toBe(404);
  });

  it('administra áreas y respuestas rápidas', async () => {
    const a = (await admin.post('/api/admin/areas', { nombre: 'Área de prueba' })).json();
    expect((await admin.put(`/api/admin/areas/${a.id}`, { nombre: 'Otra', activo: false })).json()).toEqual({
      id: a.id,
      nombre: 'Otra',
      activo: false,
    });
    const r = (await tec.post('/api/admin/respuestas', { titulo: 'Saludo', cuerpo: 'Buen día' })).json();
    expect((await tec.put(`/api/admin/respuestas/${r.id}`, { titulo: 'Hola', cuerpo: 'Hola' })).json().titulo).toBe(
      'Hola',
    );
    expect((await tec.borrar(`/api/admin/respuestas/${r.id}`)).json()).toEqual({ ok: true });
    expect((await tec.borrar(`/api/admin/respuestas/${r.id}`)).statusCode).toBe(404);
  });

  it('administra usuarios sin exponer contraseñas', async () => {
    const datos = {
      email: 'Externo@Ejemplo.com',
      nombre: 'Persona Externa',
      rol: 'tecnico',
      areaId: null,
      password: 'una-clave-bien-larga',
    };
    const r = await admin.post('/api/admin/usuarios', datos);
    expect(r.json()).toMatchObject({ email: 'externo@ejemplo.com', tienePassword: true });
    expect(r.body).not.toMatch(/argon2|passwordHash/);
    const login = await e.cliente().post('/api/auth/login', {
      email: 'externo@ejemplo.com',
      password: datos.password,
      altcha: await e.captcha(),
    });
    expect(login.statusCode).toBe(200);
    const m = await admin.patch(`/api/admin/usuarios/${r.json().id}`, { activo: false });
    expect(m.json().activo).toBe(false);
    const lista = zPaginaUsuarios.parse((await admin.get('/api/admin/usuarios?q=externa')).json());
    expect(lista.total).toBe(1);
    const yo = (await admin.get('/api/auth/yo')).json();
    const solo = await admin.patch(`/api/admin/usuarios/${yo.id}`, { activo: false });
    expect(solo.json().error).toBe('conflicto');
    expect((await admin.get('/api/auth/yo')).json().email).toBe(correo('admin'));
  });

  it('entrega notificaciones propias y estadísticas', async () => {
    const u = (await sol.get('/api/auth/yo')).json();
    const t = await crear();
    await crearNotificaciones(e.db, [
      {
        usuarioId: u.id,
        tipo: 'mensaje_nuevo',
        payload: { ticketId: t.id, codigo: t.codigo, titulo: t.titulo, texto: 'Nuevo mensaje' },
      },
    ]);
    const l = zListaNotificaciones.parse((await sol.get('/api/notificaciones')).json());
    expect(l.sinLeer).toBe(1);
    // Las de otro usuario no se pueden marcar.
    await colega.post('/api/notificaciones/leer', { ids: [l.items[0]!.id] });
    expect((await sol.get('/api/notificaciones')).json().sinLeer).toBe(1);
    await sol.post('/api/notificaciones/leer', {});
    expect((await sol.get('/api/notificaciones')).json().sinLeer).toBe(0);
    const est = await tec.get('/api/estadisticas');
    expect(zEstadisticas.parse(est.json()).kpis.abiertos).toBeGreaterThan(0);
    expect((await tec.get('/api/estadisticas?desde=ayer')).statusCode).toBe(400);
  });
});
