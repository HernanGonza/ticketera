import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { SALAS } from '@eco/shared/realtime';
import { montar, type Entorno } from '../db/base';
import { crearServidor, hasta, pausa, type Cliente, type Servidor } from './apoyo';

let e: Entorno;
/** Dos réplicas de la API sobre la misma base. */
let a: Servidor;
let b: Servidor;
let tecnico: UsuarioSesion;
let admin: UsuarioSesion;
let sofia: UsuarioSesion;
let juan: UsuarioSesion;

beforeAll(async () => {
  e = await montar();
  [tecnico, admin, sofia, juan] = (await Promise.all(
    ['tecnico', 'admin', 'solicitante', 'juan.gonzalez'].map(e.usuario),
  )) as [UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion];
  a = await crearServidor(e, { latidoClusterMs: 300 });
  b = await crearServidor(e, { latidoClusterMs: 300 });
  await hasta(async () => (await a.rt.io.of('/').adapter.serverCount()) === 2);
  await hasta(async () => (await b.rt.io.of('/').adapter.serverCount()) === 2);
});
afterAll(async () => {
  await a?.cerrar();
  await b?.cerrar();
  await e?.desmontar();
});

const nombres = (...u: UsuarioSesion[]) => u.map((x) => x.id).sort();
const presentes = (c: Cliente) => c.de('presencia').at(-1)?.usuarios.map((u) => u.id).sort();
const ve = (c: Cliente, ...u: UsuarioSesion[]) =>
  expect.poll(() => presentes(c), { timeout: 8000 }).toEqual(nombres(...u));

describe('presencia', () => {
  it('cuenta personas, no pestañas, entre réplicas y ante desconexiones', async () => {
    const ticket = await e.pedido(sofia.id);
    const sala = SALAS.ticket(ticket);
    const dueno = await a.conectar(sofia);
    await dueno.unirse(sala);
    await ve(dueno, sofia);

    const pestana1 = await b.conectar(tecnico);
    const pestana2 = await a.conectar(tecnico);
    await pestana1.unirse(sala);
    await pestana2.unirse(sala);
    await ve(dueno, sofia, tecnico);
    await ve(pestana1, sofia, tecnico);
    // Solo identificador y nombre: ni rol, ni correo, ni área.
    expect(Object.keys(dueno.de('presencia').at(-1)!.usuarios[0]!).sort()).toEqual(['id', 'nombre']);

    pestana1.socket.close();
    await pausa(300);
    await ve(dueno, sofia, tecnico);
    pestana2.socket.emit('sala:salir', { sala });
    await ve(dueno, sofia);
  });

  it('al cerrarse una réplica, las otras dejan de mostrar a sus usuarios', async () => {
    const ticket = await e.pedido(sofia.id);
    const sala = SALAS.ticket(ticket);
    const c = await crearServidor(e, { latidoClusterMs: 300 });
    await hasta(async () => (await c.rt.io.of('/').adapter.serverCount()) === 3);
    await hasta(async () => (await a.rt.io.of('/').adapter.serverCount()) === 3);
    const dueno = await a.conectar(sofia);
    await dueno.unirse(sala);
    const remoto = await c.conectar(admin);
    await remoto.unirse(sala);
    await ve(dueno, sofia, admin);
    const caida = remoto.desconectado();
    await c.cerrar();
    await ve(dueno, sofia);
    // Cierre de transporte: el cliente reconecta solo.
    await expect(caida).resolves.not.toBe('io server disconnect');
  });
});

describe('escribiendo', () => {
  it('respeta salas, permisos de escritura y la privacidad de las notas', async () => {
    const ticket = await e.pedido(sofia.id);
    const sala = SALAS.ticket(ticket);
    const dueno = await a.conectar(sofia);
    const colega = await a.conectar(juan);
    const tec = await b.conectar(tecnico);
    const otroTec = await a.conectar(admin);
    const fuera = await b.conectar(sofia);
    for (const c of [dueno, colega, tec, otroTec]) expect(await c.unirse(sala)).toBe(true);

    dueno.socket.emit('escribiendo', { ticketId: ticket, escribiendo: true });
    const aviso = await tec.esperar('escribiendo');
    expect(aviso).toEqual({
      ticketId: ticket,
      usuario: { id: sofia.id, nombre: expect.any(String) },
      escribiendo: true,
      interno: false,
    });
    expect(dueno.de('escribiendo')).toEqual([]);

    // Nota interna: solo staff.
    tec.socket.emit('escribiendo', { ticketId: ticket, escribiendo: true, interno: true });
    await otroTec.esperar('escribiendo', (p) => p.interno);
    // No escriben: quien solo puede leer, quien pide "interno" sin ser staff y quien no está en la sala.
    colega.socket.emit('escribiendo', { ticketId: ticket, escribiendo: true });
    dueno.socket.emit('escribiendo', { ticketId: ticket, escribiendo: true, interno: true });
    fuera.socket.emit('escribiendo', { ticketId: ticket, escribiendo: true });
    await pausa(600);
    expect(dueno.de('escribiendo').filter((p) => p.interno)).toEqual([]);
    expect(colega.de('escribiendo').filter((p) => p.interno)).toEqual([]);
    expect(otroTec.de('escribiendo').map((p) => [p.usuario.id, p.interno])).toEqual([
      [sofia.id, false],
      [tecnico.id, true],
    ]);

    // Desconectarse apaga el indicador.
    dueno.socket.close();
    await tec.esperar('escribiendo', (p) => p.usuario.id === sofia.id && !p.escribiendo);
  });
});
