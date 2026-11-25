import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aplicarEnKanban,
  aplicarEnPagina,
  compartirKanban,
  compartirMensajes,
  enviosPendientes,
  fusionarTicket,
  insertarMensaje,
  insertarNotificacion,
  marcarLeidas,
  quitarParche,
  registrarParche,
  type DatosKanban,
  type DatosMensajes,
  type MensajeLocal,
} from '../src/lib/cache';
import { claves, qKanban, qTicket } from '../src/lib/consultas';
import { crearManejadores } from '../src/lib/eventos-vivo';
import { escribiendo } from '../src/lib/vivo';
import { mensaje, ticket } from './ayudas';

describe('tickets', () => {
  it('ignora versiones más viejas que la cacheada', () => {
    const actual = ticket({ version: 3 });
    expect(fusionarTicket(actual, ticket({ version: 2, titulo: 'viejo' }))).toBe(actual);
  });
  it('conserva la referencia si nada cambió (sin parpadeo)', () => {
    const actual = ticket();
    expect(fusionarTicket(actual, ticket())).toBe(actual);
  });
  it('aplica la misma versión si cambió el último mensaje', () => {
    const r = fusionarTicket(ticket(), ticket({ ultimoMensaje: { autorNombre: 'A', extracto: 'x', creadoAt: '2026-11-23T13:00:00Z' } }));
    expect(r.ultimoMensaje?.extracto).toBe('x');
  });
  it('mantiene un parche pendiente hasta que se confirma', () => {
    const token = registrarParche('t1', { estado: 'en_curso' });
    expect(fusionarTicket(ticket(), ticket({ titulo: 'otro' })).estado).toBe('en_curso');
    quitarParche('t1', token);
    expect(fusionarTicket(ticket(), ticket({ titulo: 'otro' })).estado).toBe('nuevo');
  });
  it('inserta, reemplaza y quita cancelados en el kanban', () => {
    let d: DatosKanban = { tickets: [] };
    d = aplicarEnKanban(d, ticket());
    expect(d.tickets).toHaveLength(1);
    expect(aplicarEnKanban(d, ticket())).toBe(d);
    d = aplicarEnKanban(d, ticket({ version: 2, estado: 'asignado' }));
    expect(d.tickets[0]?.estado).toBe('asignado');
    expect(aplicarEnKanban(d, ticket({ version: 3, estado: 'cancelado' })).tickets).toHaveLength(0);
  });
  it('una recarga atrasada no retrocede una tarjeta', () => {
    const viejo = { tickets: [ticket({ version: 5, estado: 'resuelto' })] };
    expect(compartirKanban(viejo, { tickets: [ticket({ version: 4 })] }).tickets[0]?.estado).toBe('resuelto');
  });
  it('en las páginas solo reemplaza tickets presentes', () => {
    const d = { items: [ticket()], total: 1 };
    expect(aplicarEnPagina(d, ticket({ id: 'otro' }))).toBe(d);
    expect(aplicarEnPagina(d, ticket({ version: 2, titulo: 'nuevo' })).items[0]?.titulo).toBe('nuevo');
  });
});

describe('mensajes', () => {
  const optimista: MensajeLocal = { ...mensaje({ id: 'tmp-c1', clienteId: 'c1' }), envio: 'enviando' };

  it('concilia por clienteId sin duplicar, venga primero el evento o la respuesta', () => {
    const real = mensaje({ id: 'm9', clienteId: 'c1' });
    let items = insertarMensaje([optimista], real);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('m9');
    expect(items[0]?.envio).toBeUndefined();
    items = insertarMensaje(items, real);
    expect(items).toHaveLength(1);
  });
  it('un eco optimista no pisa el confirmado', () => {
    const items = [mensaje({ id: 'm9', clienteId: 'c1' })];
    expect(insertarMensaje(items, optimista)).toBe(items);
  });
  it('no retrocede una edición', () => {
    const items = [mensaje({ cuerpo: 'v2', editadoAt: '2026-11-23T14:00:00Z' })];
    expect(insertarMensaje(items, mensaje({ cuerpo: 'v1' }))).toBe(items);
  });
  it('no pierde adjuntos cuando llega una copia anterior a la subida', () => {
    const adjunto = { id: 'a', ticketId: 't1', mensajeId: 'm1', nombre: 'x.png', mime: 'image/png', bytes: 1, interno: false, subidoPor: { id: 's1', nombre: 'A' }, creadoAt: '2026-11-23T12:00:00Z' };
    expect(insertarMensaje([mensaje({ adjuntos: [adjunto] })], mensaje())[0]?.adjuntos).toHaveLength(1);
  });
  it('ordena por fecha', () => {
    const items = insertarMensaje([mensaje({ id: 'b', creadoAt: '2026-11-23T13:00:00Z' })], mensaje({ id: 'a' }));
    expect(items.map((m) => m.id)).toEqual(['a', 'b']);
  });
  it('una recarga conserva solo los envíos todavía pendientes', () => {
    enviosPendientes.add('c1');
    const viejo: DatosMensajes = { items: [optimista] };
    expect(compartirMensajes(viejo, { items: [] }).items).toHaveLength(1);
    enviosPendientes.delete('c1');
    expect(compartirMensajes(viejo, { items: [] }).items).toHaveLength(0);
  });
});

describe('notificaciones', () => {
  const n = { id: 1, tipo: 'mensaje_nuevo' as const, payload: { ticketId: 't1', codigo: 'c', titulo: 't', texto: 'x' }, leida: false, creadaAt: '2026-11-23T12:00:00Z' };
  it('no duplica y cuenta las no leídas', () => {
    const d = insertarNotificacion({ items: [], sinLeer: 0 }, n);
    expect(insertarNotificacion(d, n)).toBe(d);
    expect(d.sinLeer).toBe(1);
    expect(marcarLeidas(d, [1]).sinLeer).toBe(0);
    expect(marcarLeidas(d).items[0]?.leida).toBe(true);
  });
});

describe('eventos en vivo', () => {
  const clientes: QueryClient[] = [];
  afterEach(() => clientes.splice(0).forEach((c) => c.clear()));
  const preparar = () => {
    const qc = new QueryClient();
    clientes.push(qc);
    // Se crean las consultas con sus opciones para activar la conciliación.
    qc.getQueryCache().build(qc, qc.defaultQueryOptions(qKanban));
    qc.getQueryCache().build(qc, qc.defaultQueryOptions(qTicket('TCK-2026-000001')));
    qc.setQueryData(claves.kanban, { tickets: [ticket({ version: 2 })] });
    qc.setQueryData(qTicket('TCK-2026-000001').queryKey, { ...ticket({ version: 2 }), descripcion: 'd' } as never);
    const alertar = vi.fn();
    return { qc, alertar, m: crearManejadores(qc, { usuarioId: 'yo', alertar }) };
  };

  it('ticket:actualizado actualiza kanban y detalle, e ignora versiones viejas', () => {
    const { qc, m } = preparar();
    m['ticket:actualizado']({ ticket: ticket({ version: 3, estado: 'en_curso' }), motivos: ['estado'], actorId: 'x' });
    m['ticket:actualizado']({ ticket: ticket({ version: 1, estado: 'nuevo' }), motivos: ['estado'], actorId: 'x' });
    expect(qc.getQueryData(qKanban.queryKey)?.tickets[0]?.estado).toBe('en_curso');
    const detalle = qc.getQueryData(qTicket('TCK-2026-000001').queryKey);
    expect(detalle?.estado).toBe('en_curso');
    expect(detalle?.descripcion).toBe('d');
  });
  it('un evento propio ya aplicado no cambia referencias', () => {
    const { qc, m } = preparar();
    const antes = qc.getQueryData(qKanban.queryKey);
    m['ticket:actualizado']({ ticket: ticket({ version: 2 }), motivos: ['orden'], actorId: 'yo' });
    expect(qc.getQueryData(qKanban.queryKey)).toBe(antes);
  });
  it('avisa tickets nuevos y críticos de otros, no los propios', () => {
    const { m, alertar } = preparar();
    m['ticket:creado']({ ticket: ticket({ id: 'a' }), actorId: 'yo' });
    m['ticket:creado']({ ticket: ticket({ id: 'b' }), actorId: 'x' });
    m['ticket:actualizado']({ ticket: ticket({ version: 3, prioridad: 'critica' }), motivos: ['prioridad'], actorId: 'x' });
    expect(alertar.mock.calls.map((c) => c[1])).toEqual(['nuevo', 'critico']);
  });
  it('mensaje:nuevo agrega y apaga el indicador de escritura', () => {
    const { qc, m } = preparar();
    qc.setQueryData(claves.mensajes('t1'), { items: [] });
    const usuario = { id: 's1', nombre: 'Ana' };
    m.escribiendo({ ticketId: 't1', usuario, escribiendo: true, interno: false });
    expect(escribiendo.leer().t1).toHaveLength(1);
    m['mensaje:nuevo']({ mensaje: mensaje() });
    expect(qc.getQueryData<DatosMensajes>(claves.mensajes('t1'))?.items).toHaveLength(1);
    expect(escribiendo.leer().t1).toHaveLength(0);
  });
});
