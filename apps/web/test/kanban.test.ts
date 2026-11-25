import { describe, expect, it } from 'vitest';
import { CALENDARIO_DEFAULT } from '@eco/shared/dominio';
import { agrupar, calcularVecinos, filtrarTickets, ordenProvisional, parcheDeEstado } from '../src/lib/kanban';
import { slaDeTicket } from '../src/lib/sla';
import { ticket } from './ayudas';

const ids = ['a', 'b', 'c'];

describe('destino de un arrastre', () => {
  it('de otra columna: queda encima de la tarjeta señalada', () => {
    expect(calcularVecinos(ids, 'x', 'b')).toEqual({ despuesDeId: 'a', antesDeId: 'b' });
  });
  it('sobre la columna: al final', () => {
    expect(calcularVecinos(ids, 'x', null)).toEqual({ despuesDeId: 'c', antesDeId: null });
    expect(calcularVecinos([], 'x', null)).toEqual({ despuesDeId: null, antesDeId: null });
  });
  it('al bajar queda debajo y al subir encima', () => {
    expect(calcularVecinos(ids, 'a', 'b')).toEqual({ despuesDeId: 'b', antesDeId: 'c' });
    expect(calcularVecinos(ids, 'c', 'a')).toEqual({ despuesDeId: null, antesDeId: 'a' });
  });
  it('sin cambios no hace nada', () => {
    expect(calcularVecinos(ids, 'b', 'b')).toBeNull();
    expect(calcularVecinos(ids, 'c', null)).toBeNull();
  });
});

describe('orden provisorio', () => {
  const col = [ticket({ id: 'a', ordenKanban: 10 }), ticket({ id: 'b', ordenKanban: 20 })];
  it.each([
    [{ despuesDeId: 'a', antesDeId: 'b' }, 15],
    [{ despuesDeId: 'b', antesDeId: null }, 21],
    [{ despuesDeId: null, antesDeId: 'a' }, 9],
    [{ despuesDeId: null, antesDeId: null }, 9],
  ])('%o -> %d', (v, esperado) => expect(ordenProvisional(col, v)).toBe(esperado));
  it('agrupa y ordena por columna', () => {
    expect(agrupar([col[1]!, col[0]!]).nuevo.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('parche de estado', () => {
  const yo = { id: 'yo', nombre: 'Yo' };
  it('asigna a quien mueve a "en curso" sin responsable y pausa en espera', () => {
    expect(parcheDeEstado(ticket(), 'en_curso', yo).asignado).toEqual(yo);
    expect(parcheDeEstado(ticket(), 'en_espera', yo).enEsperaDesde).toBeTruthy();
    expect(parcheDeEstado(ticket(), 'nuevo', yo)).toEqual({});
  });
});

describe('filtros', () => {
  const ahora = new Date('2026-11-23T13:00:00Z');
  const lista = [
    ticket({ id: 'a', titulo: 'Impresión', asignado: { id: 'yo', nombre: 'Yo' } }),
    ticket({ id: 'b', prioridad: 'alta', venceResolucionAt: '2026-11-23T12:30:00Z', venceRespuestaAt: null }),
  ];
  const f = (filtros: Parameters<typeof filtrarTickets>[1]) =>
    filtrarTickets(lista, filtros, 'yo', ahora, CALENDARIO_DEFAULT).map((t) => t.id);
  it('aplica cada filtro y la búsqueda sin acentos', () => {
    expect(f({ mios: true })).toEqual(['a']);
    expect(f({ sinAsignar: true })).toEqual(['b']);
    expect(f({ prioridad: 'alta' })).toEqual(['b']);
    expect(f({ q: 'impresion' })).toEqual(['a']);
    expect(f({ vencidos: true })).toEqual(['b']);
    expect(f({})).toEqual(['a', 'b']);
  });
  it('muestra el plazo de respuesta mientras sea el más comprometido', () => {
    expect(slaDeTicket(ticket(), ahora, CALENDARIO_DEFAULT).clase).toBe('respuesta');
    expect(slaDeTicket(ticket({ primeraRespuestaAt: ahora.toISOString() }), ahora, CALENDARIO_DEFAULT).clase).toBe('resolucion');
  });
});
