import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { zTicketDetalle, zTicketEvento, zTicketResumen } from '@eco/shared/schemas';
import {
  actualizarTicket,
  autoasignar,
  autocerrarVencidos,
  calificarTicket,
  crearTicket,
  guardarCategoria,
  listarEventos,
  obtenerTicketDetalle,
  obtenerTicketResumen,
  procesarOutbox,
  revisarSla,
  ticketEventos,
  tickets,
  actualizarUsuario,
  obtenerCategoria,
} from '../../src/db';
import { lunes, montar, type Entorno } from './base';

let e: Entorno;
let sol: UsuarioSesion;
let colega: UsuarioSesion;
let ajeno: UsuarioSesion;
let tec: UsuarioSesion;
let tec2: UsuarioSesion;
let admin: UsuarioSesion;

beforeAll(async () => {
  e = await montar();
  [sol, colega, ajeno, tec, tec2, admin] = await Promise.all(
    ['solicitante', 'juan.gonzalez', 'pedro.sosa', 'tecnico', 'carolina.duarte', 'admin'].map(e.usuario),
  ) as [UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion];
});
afterAll(() => e.desmontar());
beforeEach(() => e.vaciarOutbox());

const tipos = async (id: string) =>
  (await listarEventos(e.db, id, { incluirSla: true })).map((x) => x.tipo);

describe('alta', () => {
  it('toma prioridad, área, SLA y vencimientos de la categoría y escribe evento y outbox', async () => {
    const id = await e.pedido(sol.id, lunes('18:00'), 'Internet/Red');
    const t = await e.fila(id);
    expect(t).toMatchObject({ estado: 'nuevo', prioridad: 'alta', areaId: sol.areaId, version: 1 });
    // 60 min hábiles justos hasta el cierre; 480 pasan al martes.
    expect(t.venceRespuestaAt).toEqual(lunes('19:00'));
    expect(t.venceResolucionAt).toEqual(lunes('14:00', '03'));
    expect(await tipos(id)).toEqual(['creado']);
    expect((await e.outbox()).map((o) => [o.tipo, o.payload])).toEqual([
      ['ticket.creado', { ticketId: id, actorId: sol.id }],
    ]);
  });

  it('valida los campos extra de la categoría y descarta claves desconocidas', async () => {
    const c = await e.categoria('Impresora');
    const datos = { categoriaId: c.id, titulo: 'Impresora', descripcion: 'No imprime nada' };
    await expect(crearTicket(e.db, datos, sol.id)).rejects.toMatchObject({
      status: 400,
      detalles: { campos: { problema: expect.any(String) } },
    });
    await expect(crearTicket(e.db, { ...datos, datos: { problema: 'Inventado' } }, sol.id)).rejects.toMatchObject({
      codigo: 'validacion',
    });
    const id = await crearTicket(
      e.db,
      { ...datos, datos: { problema: 'No imprime', modelo: '  HP 1102 ', sobra: 'x' } },
      sol.id,
    );
    expect((await e.fila(id)).datos).toEqual({ problema: 'No imprime', modelo: 'HP 1102' });
  });

  it('rechaza categorías inactivas', async () => {
    const c = (await obtenerCategoria(e.db, (await e.categoria('Cámaras')).id))!;
    await guardarCategoria(e.db, { ...c, activa: false }, c.id);
    await expect(
      crearTicket(e.db, { categoriaId: c.id, titulo: 'Cámara', descripcion: 'Sin imagen' }, sol.id),
    ).rejects.toMatchObject({ status: 400 });
    await guardarCategoria(e.db, c, c.id);
  });

  it('deja lo más nuevo al principio de la columna', async () => {
    const a = await e.pedido(sol.id);
    const b = await e.pedido(sol.id);
    expect((await e.fila(b)).ordenKanban).toBeLessThan((await e.fila(a)).ordenKanban);
  });
});

describe('outbox transaccional', () => {
  it('un rollback no deja ni el cambio ni el evento', async () => {
    const id = await e.pedido(sol.id);
    await e.vaciarOutbox();
    await expect(
      e.db.transaction(async (tx) => {
        await actualizarTicket(tx, id, { asignadoId: tec.id }, admin);
        throw new Error('deshacer');
      }),
    ).rejects.toThrow('deshacer');
    expect(await e.outbox()).toHaveLength(0);
    expect(await e.fila(id)).toMatchObject({ estado: 'nuevo', version: 1, asignadoId: null });
    expect(await tipos(id)).toEqual(['creado']);
  });

  it('publica en orden, reintenta los fallidos y marca publicado', async () => {
    const a = await e.pedido(sol.id);
    const b = await e.pedido(sol.id);
    const vistos: unknown[] = [];
    const n = await procesarOutbox(e.db, async (o) => {
      if (o.payload.ticketId === a) throw new Error('falló');
      vistos.push(o.payload.ticketId);
    });
    expect(n).toBe(1);
    expect(vistos).toEqual([b]);
    const [fallido, ok] = await e.outbox();
    expect(fallido).toMatchObject({ publicadoAt: null, intentos: 1, ultimoError: 'falló' });
    expect(ok!.publicadoAt).not.toBeNull();
    // Espera antes de reintentar; pasado el plazo, vuelve a tomarlo.
    expect(await procesarOutbox(e.db, async () => {})).toBe(0);
    await e.db.execute(sql`update outbox_eventos set reintentar_at = now() - interval '1 second'`);
    expect(await procesarOutbox(e.db, async () => {})).toBe(1);
  });
});

describe('máquina de estados y permisos', () => {
  it('asignar pasa a asignado, desasignar vuelve a nuevo y en curso exige técnico', async () => {
    const id = await e.pedido(sol.id);
    const r = await actualizarTicket(e.db, id, { asignadoId: tec.id }, admin);
    expect(r).toMatchObject({
      version: 2,
      cambios: { estado: { de: 'nuevo', a: 'asignado' }, asignado: { de: null, a: tec.id } },
    });
    await actualizarTicket(e.db, id, { asignadoId: null }, admin);
    expect(await e.fila(id)).toMatchObject({ estado: 'nuevo', asignadoId: null });
    // Sin técnico indicado se asigna quien hace el cambio.
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, tec2);
    expect(await e.fila(id)).toMatchObject({ estado: 'en_curso', asignadoId: tec2.id });
    await expect(actualizarTicket(e.db, id, { asignadoId: null }, tec)).rejects.toMatchObject({
      status: 409,
      codigo: 'transicion_invalida',
    });
    await actualizarTicket(e.db, id, { estado: 'asignado' }, tec);
    await actualizarTicket(e.db, id, { estado: 'nuevo' }, tec);
    expect(await e.fila(id)).toMatchObject({ estado: 'nuevo', asignadoId: null });
  });

  it('rechaza transiciones inválidas, técnicos no válidos y no registra cambios nulos', async () => {
    const id = await e.pedido(sol.id);
    await expect(actualizarTicket(e.db, id, { estado: 'resuelto' }, tec)).rejects.toMatchObject({
      status: 409,
      codigo: 'transicion_invalida',
    });
    await expect(actualizarTicket(e.db, id, { estado: 'cerrado' }, null)).rejects.toMatchObject({ status: 409 });
    await expect(actualizarTicket(e.db, id, { asignadoId: sol.id }, tec)).rejects.toMatchObject({ status: 400 });
    await expect(actualizarTicket(e.db, id, { estado: 'nuevo', prioridad: 'baja' }, tec)).resolves.toMatchObject({
      cambios: null,
      version: 1,
    });
    expect(await tipos(id)).toEqual(['creado']);
    expect(await e.outbox()).toHaveLength(1);
  });

  it('el solicitante solo cambia el estado de su propio ticket', async () => {
    const id = await e.pedido(sol.id);
    await expect(actualizarTicket(e.db, id, { estado: 'cancelado' }, ajeno)).rejects.toMatchObject({ status: 404 });
    await expect(actualizarTicket(e.db, id, { estado: 'cancelado' }, colega)).rejects.toMatchObject({ status: 403 });
    await expect(actualizarTicket(e.db, id, { prioridad: 'critica' }, sol)).rejects.toMatchObject({ status: 403 });
    await expect(actualizarTicket(e.db, id, { asignadoId: tec.id }, sol)).rejects.toMatchObject({ status: 403 });
    await expect(actualizarTicket(e.db, id, { estado: 'en_curso' }, sol)).rejects.toMatchObject({
      codigo: 'transicion_invalida',
    });
    await actualizarTicket(e.db, id, { estado: 'cancelado' }, sol);
    expect((await e.fila(id)).cerradoAt).not.toBeNull();
    await expect(actualizarTicket(e.db, 'no-es-uuid', {}, tec)).rejects.toMatchObject({ status: 404 });
  });

  it('detecta el conflicto de versión y devuelve el ticket actual', async () => {
    const id = await e.pedido(sol.id);
    await actualizarTicket(e.db, id, { prioridad: 'alta' }, tec, { version: 1 });
    const error = await actualizarTicket(e.db, id, { prioridad: 'baja' }, tec2, { version: 1 }).catch((x) => x);
    expect(error).toMatchObject({ status: 409, codigo: 'conflicto_version' });
    expect(zTicketResumen.parse(error.detalles.ticket)).toMatchObject({ prioridad: 'alta', version: 2 });
  });

  it('con dos cambios simultáneos sobre la misma versión solo gana uno', async () => {
    const id = await e.pedido(sol.id);
    const r = await Promise.allSettled([
      actualizarTicket(e.db, id, { asignadoId: tec.id }, tec, { version: 1 }),
      actualizarTicket(e.db, id, { asignadoId: tec2.id }, tec2, { version: 1 }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await e.fila(id)).version).toBe(2);
  });
});

describe('SLA', () => {
  it('en espera detiene el reloj, corre los vencimientos y descuenta en la métrica', async () => {
    const id = await e.pedido(sol.id, lunes('08:00'));
    const antes = await e.fila(id);
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, tec, { ahora: lunes('09:00') });
    await actualizarTicket(e.db, id, { estado: 'en_espera' }, tec, { ahora: lunes('10:00') });
    expect((await e.fila(id)).enEsperaDesde).toEqual(lunes('10:00'));
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, tec, { ahora: lunes('13:00') });
    let t = await e.fila(id);
    expect(t).toMatchObject({ minutosEnEspera: 180, enEsperaDesde: null });
    expect(t.venceResolucionAt!.getTime() - antes.venceResolucionAt!.getTime()).toBe(180 * 60_000);
    expect(t.venceRespuestaAt!.getTime() - antes.venceRespuestaAt!.getTime()).toBe(180 * 60_000);
    await actualizarTicket(e.db, id, { estado: 'resuelto' }, tec, { ahora: lunes('14:00') });
    t = await e.fila(id);
    expect(t).toMatchObject({ minResolucion: 180, resueltoAt: lunes('14:00') });
    // 72 horas contando solo días hábiles: de lunes 14:00 a jueves 14:00.
    expect(t.autocierreAt).toEqual(lunes('14:00', '05'));
  });

  it('reabrir limpia la resolución, cuenta la reapertura y no consume SLA mientras estuvo resuelto', async () => {
    const id = await e.pedido(sol.id, lunes('08:00'));
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, tec, { ahora: lunes('08:30') });
    await actualizarTicket(e.db, id, { estado: 'resuelto' }, tec, { ahora: lunes('09:00') });
    await calificarTicket(e.db, id, { calificacion: 2 }, sol, lunes('09:10'));
    const resuelto = await e.fila(id);
    await expect(actualizarTicket(e.db, id, { estado: 'nuevo' }, sol)).rejects.toMatchObject({ status: 409 });
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, sol, { ahora: lunes('11:00'), motivo: 'Sigue igual' });
    const t = await e.fila(id);
    expect(t).toMatchObject({
      estado: 'en_curso',
      asignadoId: tec.id,
      reabierto: 1,
      resueltoAt: null,
      minResolucion: null,
      autocierreAt: null,
      calificacion: null,
      minutosEnEspera: 120,
    });
    expect(t.venceResolucionAt!.getTime() - resuelto.venceResolucionAt!.getTime()).toBe(120 * 60_000);
    const historial = await listarEventos(e.db, id, { incluirSla: false });
    expect(historial.at(-1)).toMatchObject({ tipo: 'reabierto', aTexto: 'Sigue igual' });
  });

  it('cambiar de categoría recalcula los SLA', async () => {
    const id = await e.pedido(sol.id, lunes('08:00'));
    const c = await e.categoria('Internet/Red');
    await actualizarTicket(e.db, id, { categoriaId: c.id }, tec, { ahora: lunes('08:05') });
    expect(await e.fila(id)).toMatchObject({
      categoriaId: c.id,
      slaResolucionMin: 480,
      venceRespuestaAt: lunes('09:00'),
      venceResolucionAt: lunes('16:00'),
    });
  });

  it('alerta una sola vez al 80 % y al vencer, y no en espera', async () => {
    await e.db.execute(sql`update tickets set estado = 'cancelado'`);
    const id = await e.pedido(sol.id, lunes('08:00'), 'Internet/Red'); // 60 / 480
    expect(await revisarSla(e.db, lunes('08:30'))).toEqual([]);
    expect(await revisarSla(e.db, lunes('08:50'))).toEqual([{ ticketId: id, nivel: 'por_vencer', clase: 'respuesta' }]);
    expect(await revisarSla(e.db, lunes('08:51'))).toEqual([]);
    expect(await revisarSla(e.db, lunes('16:30'))).toEqual([
      { ticketId: id, nivel: 'vencido', clase: 'respuesta' },
      { ticketId: id, nivel: 'vencido', clase: 'resolucion' },
    ]);
    const [a, b] = await Promise.all([revisarSla(e.db, lunes('17:00')), revisarSla(e.db, lunes('17:00'))]);
    expect([...a, ...b]).toEqual([]);
    expect((await e.outbox()).filter((o) => o.tipo === 'sla.alerta')).toHaveLength(3);
    expect((await listarEventos(e.db, id, { incluirSla: false })).map((x) => x.tipo)).toEqual(['creado']);

    const otro = await e.pedido(sol.id, lunes('08:00'), 'Internet/Red');
    await actualizarTicket(e.db, otro, { estado: 'en_curso' }, tec, { ahora: lunes('08:10') });
    await actualizarTicket(e.db, otro, { estado: 'en_espera' }, tec, { ahora: lunes('08:15') });
    expect(await revisarSla(e.db, lunes('18:00'))).toEqual([]);
  });

  it('cierra automáticamente al cumplirse el plazo', async () => {
    await e.db.execute(sql`update tickets set estado = 'cancelado'`);
    const id = await e.pedido(sol.id, lunes('08:00'));
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, tec, { ahora: lunes('09:00') });
    await actualizarTicket(e.db, id, { estado: 'resuelto' }, tec, { ahora: lunes('10:00') });
    expect(await autocerrarVencidos(e.db, lunes('09:59', '05'))).toEqual([]);
    expect(await autocerrarVencidos(e.db, lunes('10:00', '05'))).toEqual([id]);
    expect(await e.fila(id)).toMatchObject({ estado: 'cerrado', autocierreAt: null, cerradoAt: lunes('10:00', '05') });
    const [ultimo] = await e.db
      .select()
      .from(ticketEventos)
      .where(and(eq(ticketEventos.ticketId, id), eq(ticketEventos.a, 'cerrado')));
    expect(ultimo!.usuarioId).toBeNull();
  });

  it('califica solo el solicitante; editable mientras está resuelto', async () => {
    const id = await e.pedido(sol.id);
    await expect(calificarTicket(e.db, id, { calificacion: 5 }, sol)).rejects.toMatchObject({ status: 409 });
    await actualizarTicket(e.db, id, { estado: 'en_curso' }, tec);
    await actualizarTicket(e.db, id, { estado: 'resuelto' }, tec);
    await expect(calificarTicket(e.db, id, { calificacion: 5 }, tec)).rejects.toMatchObject({ status: 403 });
    await expect(calificarTicket(e.db, id, { calificacion: 5 }, ajeno)).rejects.toMatchObject({ status: 404 });
    await calificarTicket(e.db, id, { calificacion: 3 }, sol);
    await calificarTicket(e.db, id, { calificacion: 4, comentario: 'Bien' }, sol);
    await actualizarTicket(e.db, id, { estado: 'cerrado' }, sol);
    await expect(calificarTicket(e.db, id, { calificacion: 1 }, sol)).rejects.toMatchObject({ status: 409 });
    const detalle = zTicketDetalle.parse(await obtenerTicketDetalle(e.db, id, { incluirInternos: false }));
    expect(detalle).toMatchObject({ calificacion: 4, comentarioCalificacion: 'Bien', estado: 'cerrado' });
    for (const x of await listarEventos(e.db, id, { incluirSla: true })) zTicketEvento.parse(x);
  });
});

describe('orden del kanban', () => {
  let a: string, b: string, c: string;
  const columna = async (estado: 'nuevo' | 'asignado' = 'nuevo') =>
    (
      await e.db
        .select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.estado, estado))
        .orderBy(tickets.ordenKanban)
    ).map((x) => x.id);

  beforeEach(async () => {
    await e.db.execute(sql`update tickets set estado = 'cancelado'`);
    c = await e.pedido(sol.id);
    b = await e.pedido(sol.id);
    a = await e.pedido(sol.id);
    await e.vaciarOutbox();
  });

  it('mueve antes o después de un vecino y al principio', async () => {
    expect(await columna()).toEqual([a, b, c]);
    await actualizarTicket(e.db, c, { posicion: { antesDeId: b, despuesDeId: a } }, tec);
    expect(await columna()).toEqual([a, c, b]);
    await actualizarTicket(e.db, a, { posicion: { despuesDeId: b } }, tec);
    expect(await columna()).toEqual([c, b, a]);
    await actualizarTicket(e.db, a, { posicion: {} }, tec);
    expect(await columna()).toEqual([a, c, b]);
    expect((await e.outbox()).at(-1)!.payload).toMatchObject({ cambios: { orden: true } });
  });

  it('no registra nada si la tarjeta ya está en ese lugar y no cuenta como actividad', async () => {
    const antes = await e.fila(b);
    for (const posicion of [{ antesDeId: c }, { despuesDeId: a }, { antesDeId: c, despuesDeId: a }])
      expect(await actualizarTicket(e.db, b, { posicion }, tec)).toMatchObject({ cambios: null });
    expect(await actualizarTicket(e.db, a, { posicion: {} }, tec)).toMatchObject({ cambios: null });
    expect(await e.outbox()).toHaveLength(0);
    await actualizarTicket(e.db, b, { posicion: {} }, tec);
    expect((await e.fila(b)).actualizadoAt).toEqual(antes.actualizadoAt);
  });

  it('al cambiar de columna respeta los vecinos válidos e ignora los que ya no están', async () => {
    await actualizarTicket(e.db, a, { asignadoId: tec.id }, tec);
    await actualizarTicket(e.db, b, { estado: 'asignado', posicion: { despuesDeId: a } }, tec);
    expect(await columna('asignado')).toEqual([a, b]);
    await actualizarTicket(e.db, c, { estado: 'asignado', posicion: { antesDeId: crypto.randomUUID() } }, tec);
    expect(await columna('asignado')).toEqual([c, a, b]);
  });

  it('rebalancea cuando se agota la precisión', async () => {
    let actual = [a, b, c];
    for (let i = 0; i < 45; i++) {
      const [x, y, z] = actual as [string, string, string];
      await actualizarTicket(e.db, z, { posicion: { antesDeId: y, despuesDeId: x } }, tec);
      actual = [x, z, y];
      expect(await columna()).toEqual(actual);
    }
    const ordenes = await Promise.all(actual.map(async (id) => (await e.fila(id)).ordenKanban));
    expect(ordenes[1]! - ordenes[0]!).toBeGreaterThan(1e-7);
    // Empates (mismo orden) también se resuelven.
    await e.db.execute(sql`update tickets set orden_kanban = 0 where estado = 'nuevo'`);
    await actualizarTicket(e.db, a, { posicion: { antesDeId: c } }, tec);
    const final = await columna();
    expect(final.indexOf(a)).toBe(final.indexOf(c) - 1);
  });

  it('soporta movimientos concurrentes sin interbloqueos', async () => {
    await Promise.all([
      actualizarTicket(e.db, a, { posicion: { despuesDeId: c } }, tec),
      actualizarTicket(e.db, b, { estado: 'asignado' }, tec2),
      actualizarTicket(e.db, c, { posicion: {} }, tec),
    ]);
    expect(await columna()).toEqual([c, a]);
  });
});

describe('asignación automática', () => {
  beforeEach(async () => {
    await e.db.execute(sql`update tickets set estado = 'cancelado'`);
  });

  it('manual no asigna; fija usa el técnico de la categoría', async () => {
    expect(await autoasignar(e.db, await e.pedido(sol.id))).toBeNull();
    const id = await e.pedido(sol.id, lunes('08:00'), 'Internet/Red');
    expect(await autoasignar(e.db, id)).toBe(tec.id);
    expect(await e.fila(id)).toMatchObject({ estado: 'asignado', asignadoId: tec.id });
    expect(await autoasignar(e.db, id)).toBeNull();
  });

  it('round-robin reparte por menor carga, también en simultáneo', async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await e.pedido(sol.id, lunes('08:00'), 'Wi-Fi'));
    const asignados = await Promise.all(ids.map((id) => autoasignar(e.db, id)));
    const porTecnico = new Map<string | null, number>();
    for (const x of asignados) porTecnico.set(x, (porTecnico.get(x) ?? 0) + 1);
    expect([...porTecnico.values()]).toEqual([2, 2, 2]);
  });

  it('desactivar al último administrador está prohibido', async () => {
    await expect(actualizarUsuario(e.db, admin.id, { activo: false })).rejects.toMatchObject({ status: 409 });
    expect(await obtenerTicketResumen(e.db, 'x')).toBeNull();
  });
});
