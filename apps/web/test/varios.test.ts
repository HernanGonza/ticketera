import { afterEach, describe, expect, it, vi } from 'vitest';
import { matrizCalor } from '../src/rutas/tablero/datos';
import { aCsv } from '../src/lib/csv';
import { CanalEscritura } from '../src/lib/escritura';
import { enlacePortal, rutaInterna } from '../src/lib/rutas';
import { salas, unirSala } from '../src/lib/vivo';

afterEach(() => vi.useRealTimers());

describe('escribiendo', () => {
  it('limita la frecuencia y se apaga por inactividad', () => {
    vi.useFakeTimers();
    const emitir = vi.fn();
    const c = new CanalEscritura(emitir, 2000, 3000);
    c.teclear();
    vi.advanceTimersByTime(500);
    c.teclear();
    expect(emitir.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(1600);
    c.teclear();
    expect(emitir.mock.calls).toEqual([[true], [true]]);
    vi.advanceTimersByTime(3000);
    expect(emitir.mock.calls.at(-1)).toEqual([false]);
    c.detener();
    expect(emitir).toHaveBeenCalledTimes(3);
  });
});

describe('salas', () => {
  it('cuenta referencias', () => {
    const a = unirSala('s');
    const b = unirSala('s');
    a();
    expect(salas.get('s')).toBe(1);
    b();
    expect(salas.has('s')).toBe(false);
  });
});

describe('rutas', () => {
  it('rechaza redirecciones externas o de ingreso', () => {
    expect(rutaInterna('/tickets/TCK-1?calificar=1')).toBe('/tickets/TCK-1?calificar=1');
    for (const r of ['https://x.com', '//x.com', '/\\x.com', '/login?x', 'kanban', 3]) expect(rutaInterna(r)).toBeUndefined();
  });
  it('agrega redirect al enlace del portal', () => {
    expect(enlacePortal('https://portal.test/app', '/lista')).toBe('https://portal.test/app?redirect=%2Flista');
    expect(enlacePortal('https://portal.test/app')).toBe('https://portal.test/app');
  });
});

describe('exportación', () => {
  it('escapa el CSV y neutraliza fórmulas', () => {
    expect(aCsv([['a;b', '=1+1', 2.5, null]])).toBe('﻿"a;b";\'=1+1;2,5;');
  });
  it('arma la matriz de calor con lunes primero', () => {
    const m = matrizCalor([{ dia: 0, hora: 3, total: 2 }, { dia: 1, hora: 0, total: 1 }]);
    expect(m[6]![3]).toBe(2);
    expect(m[0]![0]).toBe(1);
  });
});
