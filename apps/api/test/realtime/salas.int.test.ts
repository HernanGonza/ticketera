import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { SALAS } from '@eco/shared/realtime';
import { CONFIGURACION_DEFAULT } from '@eco/shared/schemas';
import { COOKIE_SESION, firmarSesion } from '../../src/auth/sesion';
import { guardarConfiguracion, usuarios } from '../../src/db';
import { origenPermitido } from '../../src/realtime';
import { montar, type Entorno } from '../db/base';
import { APP_URL, crearCliente, crearServidor, hasta, type Servidor } from './apoyo';

let e: Entorno;
let s: Servidor;
let otra: Servidor;
let admin: UsuarioSesion;
let tecnico: UsuarioSesion;
let sofia: UsuarioSesion;
/** Misma área que Sofía. */
let juan: UsuarioSesion;
/** Otra área. */
let pedro: UsuarioSesion;
let ticket: string;

beforeAll(async () => {
  e = await montar();
  [admin, tecnico, sofia, juan, pedro] = (await Promise.all(
    ['admin', 'tecnico', 'solicitante', 'juan.gonzalez', 'pedro.sosa'].map(e.usuario),
  )) as [UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion];
  ticket = await e.pedido(sofia.id);
  s = await crearServidor(e, { latidoClusterMs: 300 });
  otra = await crearServidor(e, { latidoClusterMs: 300 });
});
afterAll(async () => {
  await s?.cerrar();
  await otra?.cerrar();
  await e?.desmontar();
});

describe('autenticación', () => {
  const rechazo = async (cabeceras: Record<string, string>) => {
    const c = crearCliente(s.url, cabeceras);
    try {
      await c.conectado;
      return 'conectado';
    } catch (err) {
      return (err as Error).message;
    } finally {
      c.socket.close();
    }
  };
  const cookie = async (u: UsuarioSesion, duracion?: number, secreto = s.config.SESSION_SECRET) =>
    `${COOKIE_SESION}=${await firmarSesion(u, secreto, duracion)}`;

  it('rechaza sin cookie, con firma ajena o vencida', async () => {
    expect(await rechazo({})).toBe('no_autenticado');
    expect(await rechazo({ cookie: await cookie(sofia, 60, 'x'.repeat(40)) })).toBe('no_autenticado');
    expect(await rechazo({ cookie: await cookie(sofia, -10) })).toBe('no_autenticado');
  });

  it('rechaza a un usuario inactivo aunque su token siga vigente', async () => {
    const u = await e.usuario('maria.lopez');
    await e.db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, u.id));
    expect(await rechazo({ cookie: await cookie(u) })).toBe('no_autenticado');
  });

  it('controla el Origin', async () => {
    const c = await cookie(sofia);
    expect(await rechazo({ cookie: c, origin: 'http://maligno.example' })).not.toBe('conectado');
    expect(await rechazo({ cookie: c, origin: APP_URL })).toBe('conectado');
    const dev = { appUrl: 'http://localhost:5173', produccion: false };
    expect(origenPermitido('http://127.0.0.1:5173', dev)).toBe(true);
    expect(origenPermitido('http://127.0.0.1:9999', dev)).toBe(false);
    expect(origenPermitido('http://127.0.0.1:5173', { ...dev, produccion: true })).toBe(false);
    expect(origenPermitido('null', dev)).toBe(false);
  });

  it('desconecta al vencer la sesión', async () => {
    const c = await s.conectar(sofia, 2);
    await expect(c.desconectado()).resolves.toBe('io server disconnect');
  });

  it('toma el rol de la base: un token con otro rol obliga a refrescar', async () => {
    expect(await rechazo({ cookie: await cookie({ ...pedro, rol: 'admin' }) })).toBe('no_autenticado');
  });

  it('vuelve a leer el rol al pedir una sala', async () => {
    const c = await s.conectar(tecnico);
    await e.db.update(usuarios).set({ rol: 'solicitante' }).where(eq(usuarios.id, tecnico.id));
    expect(await c.unirse(SALAS.tecnicos)).toBe(false);
    await e.db.update(usuarios).set({ rol: 'tecnico' }).where(eq(usuarios.id, tecnico.id));
  });

  it('rechaza una sesión revocada', async () => {
    const token = await firmarSesion(sofia, s.config.SESSION_SECRET, 60, '00000000-0000-4000-8000-000000000001');
    expect(await rechazo({ cookie: `${COOKIE_SESION}=${token}` })).toBe('no_autenticado');
  });
});

describe('salas', () => {
  it('el staff entra a tecnicos, tablero y al ticket con su sala interna', async () => {
    const c = await s.conectar(tecnico);
    expect(await c.unirse(SALAS.tecnicos)).toBe(true);
    expect(await c.unirse(SALAS.tablero)).toBe(true);
    expect(await c.unirse(SALAS.ticket(ticket))).toBe(true);
    const salas = [...s.rt.io.of('/').sockets.get(c.socket.id!)!.rooms];
    expect(salas).toEqual(
      expect.arrayContaining([SALAS.todos, SALAS.usuario(tecnico.id), SALAS.ticketInterno(ticket)]),
    );
    c.socket.emit('sala:salir', { sala: SALAS.ticket(ticket) });
    await hasta(() => !s.rt.io.of('/').sockets.get(c.socket.id!)!.rooms.has(SALAS.ticketInterno(ticket)));
  });

  it('el solicitante no entra a salas ajenas, de staff, internas ni inventadas', async () => {
    const dueno = await s.conectar(sofia);
    const ajeno = await s.conectar(pedro);
    for (const sala of [
      SALAS.tecnicos,
      SALAS.tablero,
      SALAS.ticket(ticket),
      SALAS.ticketInterno(ticket),
      SALAS.usuario(sofia.id),
      SALAS.usuario(pedro.id),
      SALAS.todos,
      'ticket:00000000-0000-4000-8000-000000000000',
      'ticket:TCK-2026-000001',
      'cualquiera',
    ])
      expect(await ajeno.unirse(sala), sala).toBe(false);
    expect(await dueno.unirse(SALAS.ticket(ticket))).toBe(true);
    expect(await dueno.unirse(SALAS.ticketInterno(ticket))).toBe(false);
    expect(s.rt.io.of('/').sockets.get(dueno.socket.id!)!.rooms.has(SALAS.ticketInterno(ticket))).toBe(false);
  });

  it('ignora cargas mal formadas sin caerse', async () => {
    const c = await s.conectar(sofia);
    const crudo = c.socket as unknown as { emit: (...a: unknown[]) => void };
    crudo.emit('sala:unirse');
    crudo.emit('sala:unirse', { sala: SALAS.ticket(ticket) });
    crudo.emit('sala:salir', null);
    crudo.emit('escribiendo', { ticketId: 5 });
    const r = await new Promise((ok) => crudo.emit('sala:unirse', 'hola', ok));
    expect(r).toEqual({ ok: false });
    expect(await c.unirse(SALAS.ticket(ticket))).toBe(true);
  });

  it('limita la tasa de pedidos', async () => {
    const c = await s.conectar(sofia);
    const respuestas = await Promise.all(Array.from({ length: 90 }, () => c.unirse(SALAS.ticket(ticket))));
    expect(respuestas.filter(Boolean).length).toBeGreaterThan(0);
    expect(respuestas.filter((ok) => !ok).length).toBeGreaterThan(20);
  });

  it('quien comparte área entra solo si la configuración lo permite, y se reevalúa en todas las réplicas', async () => {
    const colega = await otra.conectar(juan);
    const staff = await otra.conectar(admin);
    expect(await colega.unirse(SALAS.ticket(ticket))).toBe(true);
    expect(await staff.unirse(SALAS.ticket(ticket))).toBe(true);
    const sala = (c: typeof colega) => otra.rt.io.of('/').sockets.get(c.socket.id!)!.rooms;
    // Espera a que las réplicas se conozcan.
    await hasta(async () => (await s.rt.io.of('/').adapter.serverCount()) === 2);
    await guardarConfiguracion(e.db, { ...CONFIGURACION_DEFAULT, solicitanteVeArea: false });
    s.rt.io.serverSideEmit('eco:reevaluar');
    await hasta(() => !sala(colega).has(SALAS.ticket(ticket)));
    expect(sala(staff).has(SALAS.ticketInterno(ticket))).toBe(true);
    expect(await colega.unirse(SALAS.ticket(ticket))).toBe(false);
    await guardarConfiguracion(e.db, CONFIGURACION_DEFAULT);
  });
});
