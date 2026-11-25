import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UsuarioSesion } from '@eco/shared/dominio';
import {
  zAdjunto,
  zCatalogo,
  zFiltroTickets,
  zFiltroUsuarios,
  zListaNotificaciones,
  zMensaje,
  zPaginaUsuarios,
  zTicketDetalle,
  zTicketResumen,
} from '@eco/shared/schemas';
import {
  accesoTicket,
  actualizarTicket,
  crearMensaje,
  crearNotificaciones,
  crearTicket,
  editarMensaje,
  leerConfiguracion,
  listarMensajes,
  listarNotificaciones,
  listarTickets,
  listarUsuarios,
  marcarLeido,
  marcarNotificaciones,
  noLeidos,
  obtenerAdjunto,
  obtenerCatalogo,
  obtenerMensaje,
  obtenerTicketDetalle,
  obtenerTicketResumen,
  registrarAdjunto,
} from '../../src/db';
import { lunes, montar, type Entorno } from './base';

let e: Entorno;
let sol: UsuarioSesion;
let colega: UsuarioSesion;
let ajeno: UsuarioSesion;
let tec: UsuarioSesion;
let id: string;

beforeAll(async () => {
  e = await montar();
  [sol, colega, ajeno, tec] = (await Promise.all(
    ['solicitante', 'juan.gonzalez', 'pedro.sosa', 'tecnico'].map(e.usuario),
  )) as [UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion];
  id = await e.pedido(sol.id, lunes('08:00'));
});
afterAll(() => e.desmontar());

describe('mensajes', () => {
  it('registra la primera respuesta solo con un mensaje público de staff, sin cambiar la versión', async () => {
    await e.vaciarOutbox();
    await crearMensaje(e.db, { ticketId: id, cuerpo: 'nota', interno: true }, tec, lunes('08:10'));
    await crearMensaje(e.db, { ticketId: id, cuerpo: 'hola' }, sol, lunes('08:20'));
    expect((await e.fila(id)).primeraRespuestaAt).toBeNull();
    await crearMensaje(e.db, { ticketId: id, cuerpo: '**Buen día**, [vemos](http://x)' }, tec, lunes('08:30'));
    const t = await e.fila(id);
    expect(t).toMatchObject({ primeraRespuestaAt: lunes('08:30'), minPrimeraRespuesta: 30, version: 1 });
    expect((await e.outbox()).map((o) => o.tipo)).toEqual([
      'mensaje.creado',
      'mensaje.creado',
      'mensaje.creado',
      'ticket.actualizado',
    ]);
    // Una nota posterior no aparece como último mensaje.
    await crearMensaje(e.db, { ticketId: id, cuerpo: 'secreto', interno: true }, tec, lunes('08:40'));
    const resumen = zTicketResumen.parse(await obtenerTicketResumen(e.db, id));
    expect(resumen.ultimoMensaje).toMatchObject({ autorNombre: tec.nombre, extracto: 'Buen día, vemos' });
    expect(resumen.actualizadoAt).toBe(lunes('08:30').toISOString());
  });

  it('es idempotente por clienteId, también en reintentos simultáneos', async () => {
    const datos = { ticketId: id, cuerpo: 'una sola vez', clienteId: 'abc' };
    const r = await Promise.all([1, 2, 3].map(() => crearMensaje(e.db, datos, sol)));
    expect(new Set(r.map((x) => x.id)).size).toBe(1);
    expect(r.filter((x) => x.creado)).toHaveLength(1);
    // El mismo clienteId de otro autor es otro mensaje.
    expect((await crearMensaje(e.db, datos, tec)).creado).toBe(true);
  });

  it('controla quién escribe, qué se ve y quién edita', async () => {
    await expect(crearMensaje(e.db, { ticketId: id, cuerpo: 'x' }, colega)).rejects.toMatchObject({ status: 403 });
    await expect(crearMensaje(e.db, { ticketId: id, cuerpo: 'x' }, ajeno)).rejects.toMatchObject({ status: 404 });
    await expect(crearMensaje(e.db, { ticketId: id, cuerpo: 'x', interno: true }, sol)).rejects.toMatchObject({
      status: 403,
    });
    const publicos = await listarMensajes(e.db, id, { incluirInternos: false });
    const todos = await listarMensajes(e.db, id, { incluirInternos: true });
    expect(publicos.some((m) => m.interno)).toBe(false);
    expect(todos.length).toBe(publicos.length + 2);
    todos.forEach((m) => zMensaje.parse(m));

    const propio = publicos.find((m) => m.autor.id === sol.id)!;
    await expect(editarMensaje(e.db, propio.id, 'otro', tec)).rejects.toMatchObject({ status: 403 });
    expect(await editarMensaje(e.db, propio.id, 'editado', sol)).toMatchObject({ cambiado: true, ticketId: id });
    expect((await obtenerMensaje(e.db, propio.id))!.editadoAt).not.toBeNull();
    const interno = todos.find((m) => m.interno)!;
    await expect(editarMensaje(e.db, interno.id, 'x', sol)).rejects.toMatchObject({ status: 404 });
  });

  it('los adjuntos heredan la visibilidad del mensaje', async () => {
    const nota = await crearMensaje(e.db, { ticketId: id, cuerpo: 'foto', interno: true }, tec);
    const datos = { ticketId: id, ruta: 'ab/cd.png', nombre: 'a.png', mime: 'image/png', bytes: 10 };
    await expect(registrarAdjunto(e.db, { ...datos, mensajeId: nota.id }, sol)).rejects.toMatchObject({ status: 404 });
    const interno = await registrarAdjunto(e.db, { ...datos, mensajeId: nota.id }, tec);
    const publico = await registrarAdjunto(e.db, datos, sol);
    const visible = zTicketDetalle.parse(await obtenerTicketDetalle(e.db, id, { incluirInternos: false }));
    expect(visible.adjuntos.map((a) => a.id)).toEqual([publico]);
    expect((await obtenerTicketDetalle(e.db, id, { incluirInternos: true }))!.adjuntos).toHaveLength(2);
    const a = await obtenerAdjunto(e.db, interno);
    expect(a).toMatchObject({ interno: true, ruta: 'ab/cd.png' });
    zAdjunto.parse(a);
    expect((await obtenerMensaje(e.db, nota.id))!.adjuntos).toHaveLength(1);
  });

  it('cuenta no leídos según el rol y la lectura no retrocede', async () => {
    await e.db.execute(sql`delete from lecturas`);
    const mensajes = await listarMensajes(e.db, id, { incluirInternos: true });
    const paraSol = mensajes.filter((m) => !m.interno && m.autor.id !== sol.id);
    expect((await noLeidos(e.db, sol)).porTicket[id]).toBe(paraSol.length);
    expect((await noLeidos(e.db, tec)).total).toBe(mensajes.filter((m) => m.autor.id !== tec.id).length);
    expect((await noLeidos(e.db, ajeno)).total).toBe(0);

    const ultimo = mensajes.filter((m) => !m.interno).at(-1)!;
    expect(await marcarLeido(e.db, id, sol, ultimo.id)).toBe(true);
    expect(await marcarLeido(e.db, id, sol, mensajes[0]!.interno ? ultimo.id : mensajes[0]!.id)).toBe(false);
    expect(await noLeidos(e.db, sol)).toEqual({ total: 0, porTicket: {} });
    const nota = mensajes.find((m) => m.interno)!;
    await expect(marcarLeido(e.db, id, sol, nota.id)).rejects.toMatchObject({ status: 404 });
  });

  it('notificaciones propias', async () => {
    const payload = { ticketId: id, codigo: 'TCK', titulo: 't', texto: 'x' };
    const creadas = await crearNotificaciones(e.db, [
      { usuarioId: sol.id, tipo: 'mensaje_nuevo', payload },
      { usuarioId: tec.id, tipo: 'mensaje_nuevo', payload },
    ]);
    expect(await marcarNotificaciones(e.db, sol.id, [creadas[1]!.notificacion.id])).toBe(0);
    expect(await marcarNotificaciones(e.db, sol.id)).toBe(1);
    const lista = zListaNotificaciones.parse(await listarNotificaciones(e.db, tec.id));
    expect(lista.sinLeer).toBe(1);
  });
});

describe('consultas', () => {
  it('accesoTicket acepta uuid o código y tolera entradas inválidas', async () => {
    const t = await e.fila(id);
    const esperado = { id, solicitanteId: sol.id, areaId: sol.areaId };
    expect(await accesoTicket(e.db, id)).toEqual(esperado);
    expect(await accesoTicket(e.db, t.codigo.toLowerCase())).toEqual(esperado);
    for (const malo of ['', 'x', "' or 1=1 --", 'TCK-2026-999999', crypto.randomUUID()])
      expect(await accesoTicket(e.db, malo)).toBeNull();
  });

  it('aplica visibilidad, búsqueda sin acentos, filtros y orden por prioridad', async () => {
    const c = await e.categoria('Otro');
    const otro = await crearTicket(
      e.db,
      { categoriaId: c.id, titulo: 'Conexión caída 100%', descripcion: 'sin señal en la oficina' },
      ajeno.id,
    );
    const mio = await e.pedido(colega.id);
    await actualizarTicket(e.db, otro, { prioridad: 'critica' }, tec);
    const config = await leerConfiguracion(e.db);
    const listar = async (u: UsuarioSesion, f: object, cfg = config) =>
      listarTickets(e.db, zFiltroTickets.parse(f), u, cfg);

    expect((await listar(sol, { ambito: 'mios' })).items.map((t) => t.id)).toEqual([id]);
    expect((await listar(sol, { ambito: 'area' })).total).toBe(2);
    expect((await listar(sol, { ambito: 'todos' })).items.map((t) => t.id).sort()).toEqual([id, mio].sort());
    const sinArea = { ...config, solicitanteVeArea: false };
    expect((await listar(sol, { ambito: 'area' }, sinArea)).total).toBe(1);
    expect((await listar(sol, { ambito: 'todos' }, sinArea)).total).toBe(1);
    expect((await listar(sol, { ambito: 'todos', q: 'conexion' })).total).toBe(0);
    expect((await listar(tec, { ambito: 'todos', q: 'CONEXION' })).items[0]!.id).toBe(otro);
    expect((await listar(tec, { ambito: 'todos', q: 'señal' })).total).toBe(1);
    expect((await listar(tec, { ambito: 'todos', q: '100%' })).total).toBe(1);
    expect((await listar(tec, { ambito: 'todos', q: '%%%' })).total).toBe(0);
    expect((await listar(tec, { ambito: 'todos', q: (await e.fila(mio)).codigo })).total).toBe(1);
    const porPrioridad = await listar(tec, { ambito: 'todos', orden: 'prioridad', dir: 'desc', porPagina: 1 });
    expect(porPrioridad).toMatchObject({ total: 3 });
    expect(porPrioridad.items.map((t) => t.id)).toEqual([otro]);
    expect((await listar(tec, { ambito: 'todos', vencidos: 'true' })).total).toBe(2); // los creados en marzo
    expect((await listar(tec, { ambito: 'todos', vencidos: 'false' })).total).toBe(1);
    expect((await listar(tec, { ambito: 'todos', sinAsignar: 'true', prioridad: 'baja,media' })).total).toBe(2);
  });

  it('catálogo y usuarios respetan los DTO', async () => {
    const deStaff = zCatalogo.parse(await obtenerCatalogo(e.db, tec));
    expect(deStaff.tecnicos).toHaveLength(4);
    expect(deStaff.categorias).toHaveLength(12);
    const deSol = zCatalogo.parse(await obtenerCatalogo(e.db, sol));
    expect(deSol.tecnicos).toEqual([]);
    expect(deSol.respuestasRapidas).toEqual([]);
    const pagina = zPaginaUsuarios.parse(await listarUsuarios(e.db, zFiltroUsuarios.parse({ q: 'nunez' })));
    expect(pagina.items[0]).toMatchObject({ nombre: 'Valeria Núñez', tienePassword: true });
  });
});
