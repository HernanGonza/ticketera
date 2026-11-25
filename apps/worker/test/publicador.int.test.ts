/** Extremo a extremo: operación de datos → outbox → publicador → adapter → cliente Socket.IO. */
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actualizarTicket,
  actualizarUsuario,
  crearMensaje,
  crearTicket,
  guardarConfiguracion,
  notificaciones,
  outboxEventos,
  registrarAdjunto,
} from '@eco/api/db';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { SALAS } from '@eco/shared/realtime';
import { CONFIGURACION_DEFAULT } from '@eco/shared/schemas';
import { crearServidor, hasta, pausa, type Cliente, type Servidor } from '../../api/test/realtime/apoyo';
import { montarWorker, type EntornoWorker } from './apoyo';

const SECRETO = 'SECRETO-INTERNO';

let e: EntornoWorker;
let a: Servidor;
let b: Servidor;
let admin: UsuarioSesion;
let tecnico: UsuarioSesion;
let sofia: UsuarioSesion;
let juan: UsuarioSesion;
let pedro: UsuarioSesion;

/** Clientes: el dueño y un colega de área en una réplica; el staff en la otra. */
let dueno: Cliente;
let colega: Cliente;
let ajeno: Cliente;
let tec: Cliente;
let tablero: Cliente;

beforeAll(async () => {
  e = await montarWorker();
  [admin, tecnico, sofia, juan, pedro] = (await e.usuarios(
    'admin',
    'tecnico',
    'solicitante',
    'juan.gonzalez',
    'pedro.sosa',
  )) as [UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion];
  await e.vaciarOutbox();
  await e.iniciar();
  a = await crearServidor(e, { latidoClusterMs: 300 });
  b = await crearServidor(e, { latidoClusterMs: 300 });
  await hasta(async () => (await a.rt.io.of('/').adapter.serverCount()) === 2);
  dueno = await a.conectar(sofia);
  colega = await a.conectar(juan);
  ajeno = await a.conectar(pedro);
  tec = await b.conectar(tecnico);
  tablero = await b.conectar(admin);
  expect(await tec.unirse(SALAS.tecnicos)).toBe(true);
  expect(await tablero.unirse(SALAS.tablero)).toBe(true);
  // Las conexiones LISTEN del adapter se abren en segundo plano.
  await pausa(500);
});
afterAll(async () => {
  await a?.cerrar();
  await b?.cerrar();
  await e?.desmontar();
});

const limpiar = () => [dueno, colega, ajeno, tec, tablero].forEach((c) => c.limpiar());

async function nuevoTicket() {
  const categoria = await e.categoria('Otro');
  return crearTicket(
    e.db,
    { categoriaId: categoria.id, titulo: 'No anda la impresora', descripcion: 'Descripción de prueba' },
    sofia.id,
  );
}

describe('publicación', () => {
  it('entrega el alta una sola vez por socket y solo a quien corresponde', async () => {
    limpiar();
    // El técnico, además, está en `tecnicos` y en su sala de usuario: igual debe recibirlo una vez.
    const id = await nuevoTicket();
    const creado = await tec.esperar('ticket:creado', (p) => p.ticket.id === id);
    expect(creado.actorId).toBe(sofia.id);
    await dueno.esperar('ticket:creado', (p) => p.ticket.id === id);
    await tec.esperar('notificacion:nueva', (p) => p.notificacion.payload.ticketId === id);
    await tablero.esperar('tablero:actualizar');
    await pausa(500);
    expect(dueno.de('ticket:creado')).toHaveLength(1);
    expect(tec.de('ticket:creado')).toHaveLength(1);
    expect(tablero.de('ticket:creado')).toEqual([]);
    for (const c of [colega, ajeno]) expect(c.recibidos).toEqual([]);
    // El solicitante no se avisa a sí mismo en la aplicación.
    expect(dueno.de('notificacion:nueva')).toEqual([]);
    await e.reposo();
    expect(e.enviados.filter((m) => m.asunto.includes('Recibimos su pedido')).map((m) => m.para)).toEqual([
      sofia.email,
    ]);
    expect(e.enviados.some((m) => m.para === tecnico.email && m.asunto.includes('Nuevo pedido'))).toBe(true);
  });

  it('las notas internas y sus adjuntos no salen de la sala interna', async () => {
    const id = await nuevoTicket();
    await actualizarTicket(e.db, id, { asignadoId: tecnico.id }, admin);
    for (const c of [dueno, colega, tec]) expect(await c.unirse(SALAS.ticket(id))).toBe(true);
    await e.reposo();
    limpiar();
    e.enviados.splice(0);

    const nota = await crearMensaje(e.db, { ticketId: id, cuerpo: `${SECRETO}: revisar`, interno: true }, admin);
    const adjunto = await registrarAdjunto(
      e.db,
      { ticketId: id, mensajeId: nota.id, ruta: 'x', nombre: `${SECRETO}.pdf`, mime: 'application/pdf', bytes: 1 },
      admin,
    );
    await tec.esperar('mensaje:nuevo', (p) => p.mensaje.id === nota.id);
    await tec.esperar('adjunto:nuevo', (p) => p.adjuntoId === adjunto);
    await tec.esperar('notificacion:nueva', (p) => p.notificacion.payload.ticketId === id);
    await e.reposo();
    await pausa(300);

    for (const c of [dueno, colega, ajeno]) {
      expect(c.recibidos).toEqual([]);
    }
    expect(e.enviados).toEqual([]);
    const avisos = await e.db.select().from(notificaciones).where(eq(notificaciones.usuarioId, sofia.id));
    expect(JSON.stringify(avisos)).not.toContain(SECRETO);

    // Un mensaje público posterior no arrastra la nota (ni en el resumen ni en el correo).
    const publico = await crearMensaje(e.db, { ticketId: id, cuerpo: 'Ya lo estamos viendo' }, admin);
    for (const c of [dueno, colega, tec]) await c.esperar('mensaje:nuevo', (p) => p.mensaje.id === publico.id);
    await dueno.esperar('no-leidos:actualizar', (p) => p.ticketId === id);
    await dueno.esperar('ticket:actualizado', (p) => p.motivos.includes('mensaje'));
    await e.reposo();
    await pausa(300);
    expect(dueno.de('mensaje:nuevo')).toHaveLength(1);
    expect(tec.de('mensaje:nuevo')).toHaveLength(2);
    expect(JSON.stringify([dueno.recibidos, colega.recibidos, ajeno.recibidos])).not.toContain(SECRETO);
    expect(e.enviados.length).toBeGreaterThan(0);
    expect(JSON.stringify(e.enviados)).not.toContain(SECRETO);
    expect(ajeno.recibidos).toEqual([]);
  });

  it('transporta mensajes de más de 8000 bytes por la tabla de adjuntos', async () => {
    const id = await nuevoTicket();
    await dueno.unirse(SALAS.ticket(id));
    const cuerpo = 'ñandú '.repeat(1600).trim();
    const m = await crearMensaje(e.db, { ticketId: id, cuerpo }, tecnico);
    const llegado = await dueno.esperar('mensaje:nuevo', (p) => p.mensaje.id === m.id);
    expect(llegado.mensaje.cuerpo).toBe(cuerpo);
  });

  it('llega al cliente en menos de 300 ms desde la confirmación', async () => {
    const id = await nuevoTicket();
    await dueno.unirse(SALAS.ticket(id));
    await e.reposo();
    const tiempos: number[] = [];
    for (let i = 0; i < 15; i++) {
      await pausa(60);
      const m = await crearMensaje(e.db, { ticketId: id, cuerpo: `Medición ${i}` }, tecnico);
      const confirmado = performance.now();
      await dueno.esperar('mensaje:nuevo', (p) => p.mensaje.id === m.id);
      const r = dueno.recibidos.find(
        (x) => x.evento === 'mensaje:nuevo' && (x.payload as { mensaje: { id: string } }).mensaje.id === m.id,
      )!;
      tiempos.push(Math.max(0, r.en - confirmado));
    }
    tiempos.sort((x, y) => x - y);
    const mediana = tiempos[7]!;
    const maximo = tiempos.at(-1)!;
    console.log(`Latencia commit → cliente: mediana ${mediana.toFixed(1)} ms, máxima ${maximo.toFixed(1)} ms`);
    expect(maximo).toBeLessThan(300);
  });

  it('desconecta en todas las réplicas a quien cambia de acceso', async () => {
    const pestana = await b.conectar(pedro);
    const caidas = Promise.all([ajeno.desconectado(), pestana.desconectado()]);
    await actualizarUsuario(e.db, pedro.id, { rol: 'tecnico' });
    await expect(caidas).resolves.toEqual(['io server disconnect', 'io server disconnect']);
    expect(dueno.socket.connected).toBe(true);
    await actualizarUsuario(e.db, pedro.id, { rol: 'solicitante' });
  });

  it('al cambiar la visibilidad por área saca de las salas y avisa el cambio de catálogo', async () => {
    const id = await nuevoTicket();
    const sala = SALAS.ticket(id);
    expect(await colega.unirse(sala)).toBe(true);
    limpiar();
    await guardarConfiguracion(e.db, { ...CONFIGURACION_DEFAULT, solicitanteVeArea: false });
    await colega.esperar('catalogo:actualizado', (p) => p.recurso === 'configuracion');
    await hasta(() => !a.rt.io.of('/').sockets.get(colega.socket.id!)!.rooms.has(sala));
    const m = await crearMensaje(e.db, { ticketId: id, cuerpo: 'Solo para el dueño' }, tecnico);
    await dueno.esperar('mensaje:nuevo', (p) => p.mensaje.id === m.id);
    await pausa(300);
    expect(colega.de('mensaje:nuevo')).toEqual([]);
    await guardarConfiguracion(e.db, CONFIGURACION_DEFAULT);
  });
});

describe('resistencia', () => {
  it('no pierde ni repite eventos al reiniciar, y publica en orden', async () => {
    await e.reposo();
    await e.detenerWorkers();
    limpiar();
    const ids = [await nuevoTicket(), await nuevoTicket(), await nuevoTicket()];
    await actualizarTicket(e.db, ids[0]!, { prioridad: 'critica' }, admin);
    await pausa(500);
    expect(tec.de('ticket:creado')).toEqual([]);
    expect(await e.pendientes()).toBe(4);

    // Dos instancias a la vez: una sola publica cada evento.
    await Promise.all([e.iniciar(), e.iniciar()]);
    await e.reposo();
    await tec.esperar('ticket:actualizado', (p) => p.ticket.id === ids[0]);
    expect(tec.de('ticket:creado').map((p) => p.ticket.id)).toEqual(ids);
    for (const id of ids) {
      const avisos = await e.db.select().from(notificaciones).where(eq(notificaciones.usuarioId, tecnico.id));
      expect(avisos.filter((n) => n.payload.ticketId === id && n.tipo === 'ticket_creado')).toHaveLength(1);
    }
  });

  it('un evento que falla no deja efectos a medias y no frena a los demás', async () => {
    await e.vaciarOutbox();
    await e.db.insert(outboxEventos).values({ tipo: 'inexistente' as never, payload: {} });
    limpiar();
    const id = await nuevoTicket();
    await tec.esperar('ticket:creado', (p) => p.ticket.id === id);
    // Se reintenta y al décimo intento se descarta.
    await hasta(
      async () => (await e.db.select().from(outboxEventos).where(isNull(outboxEventos.publicadoAt))).length === 0,
      25_000,
    );
    const [malo] = await e.db.select().from(outboxEventos).where(eq(outboxEventos.tipo, 'inexistente' as never));
    expect(malo!.intentos).toBe(10);
    expect(malo!.ultimoError).toContain('desconocido');
  });
});
