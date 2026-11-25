import { describe, expect, it } from 'vitest';
import {
  CALENDARIO_DEFAULT as CAL,
  estadoSla,
  minutosHabilesEntre,
  sumarHorasEnDiasHabiles,
  sumarMinutosHabiles,
  type Calendario,
} from '../src/dominio';

/** Marzo de 2026: el 2 es lunes. Hora argentina (UTC-3). */
const f = (dia: number, hora: string) => new Date(`2026-03-${String(dia).padStart(2, '0')}T${hora}:00-03:00`);
const conFeriado: Calendario = { ...CAL, feriados: ['2026-03-03'] };

describe('sumarMinutosHabiles', () => {
  it('suma dentro del día y pasa al siguiente', () => {
    expect(sumarMinutosHabiles(f(2, '08:00'), 90, CAL)).toEqual(f(2, '09:30'));
    expect(sumarMinutosHabiles(f(2, '18:30'), 60, CAL)).toEqual(f(3, '07:30'));
    expect(sumarMinutosHabiles(f(2, '07:00'), 720, CAL)).toEqual(f(2, '19:00'));
    expect(sumarMinutosHabiles(f(2, '07:00'), 1441, CAL)).toEqual(f(4, '07:01'));
  });
  it('arranca en la próxima apertura si está fuera de horario', () => {
    expect(sumarMinutosHabiles(f(2, '03:00'), 30, CAL)).toEqual(f(2, '07:30'));
    expect(sumarMinutosHabiles(f(2, '23:30'), 30, CAL)).toEqual(f(3, '07:30'));
    expect(sumarMinutosHabiles(f(7, '12:00'), 30, CAL)).toEqual(f(9, '07:30'));
  });
  it('un pedido del viernes a la tarde no vence el sábado', () => {
    expect(sumarMinutosHabiles(f(6, '18:00'), 120, CAL)).toEqual(f(9, '08:00'));
  });
  it('saltea feriados', () => {
    expect(sumarMinutosHabiles(f(2, '18:00'), 120, conFeriado)).toEqual(f(4, '08:00'));
  });
  it('es aditiva', () => {
    expect(sumarMinutosHabiles(sumarMinutosHabiles(f(5, '15:00'), 500, CAL), 700, CAL)).toEqual(
      sumarMinutosHabiles(f(5, '15:00'), 1200, CAL),
    );
  });
  it('rechaza calendarios inválidos', () => {
    expect(() => sumarMinutosHabiles(f(2, '08:00'), 1, { ...CAL, dias: [] })).toThrow();
    expect(() => sumarMinutosHabiles(f(2, '08:00'), 1, { ...CAL, desde: '19:00', hasta: '07:00' })).toThrow();
  });
});

describe('minutosHabilesEntre', () => {
  it('cuenta solo el horario hábil', () => {
    expect(minutosHabilesEntre(f(2, '08:00'), f(2, '09:30'), CAL)).toBe(90);
    expect(minutosHabilesEntre(f(6, '18:00'), f(9, '08:00'), CAL)).toBe(120);
    expect(minutosHabilesEntre(f(7, '08:00'), f(8, '20:00'), CAL)).toBe(0);
    expect(minutosHabilesEntre(f(2, '00:00'), f(9, '00:00'), CAL)).toBe(5 * 720);
    expect(minutosHabilesEntre(f(2, '00:00'), f(9, '00:00'), conFeriado)).toBe(4 * 720);
  });
  it('devuelve 0 si el intervalo está invertido', () => {
    expect(minutosHabilesEntre(f(3, '10:00'), f(2, '10:00'), CAL)).toBe(0);
  });
  it('es inversa de sumarMinutosHabiles', () => {
    for (const m of [1, 59, 720, 721, 5000])
      expect(minutosHabilesEntre(f(5, '17:13'), sumarMinutosHabiles(f(5, '17:13'), m, CAL), CAL)).toBe(m);
  });
});

describe('sumarHorasEnDiasHabiles', () => {
  it('72 h corridas salteando fines de semana y feriados', () => {
    expect(sumarHorasEnDiasHabiles(f(2, '10:00'), 72, CAL)).toEqual(f(5, '10:00'));
    expect(sumarHorasEnDiasHabiles(f(5, '10:00'), 72, CAL)).toEqual(f(10, '10:00'));
    expect(sumarHorasEnDiasHabiles(f(2, '10:00'), 24, conFeriado)).toEqual(f(4, '10:00'));
    expect(sumarHorasEnDiasHabiles(f(7, '15:00'), 2, CAL)).toEqual(f(9, '02:00'));
  });
});

describe('estadoSla', () => {
  const base = { creadoAt: f(2, '07:00'), venceAt: f(2, '17:00'), totalMin: 600, enEsperaDesde: null, cumplidoAt: null };
  it('pasa de ok a por vencer (80 %) y vencido', () => {
    expect(estadoSla(base, f(2, '14:59'), CAL).semaforo).toBe('ok');
    expect(estadoSla(base, f(2, '15:00'), CAL)).toMatchObject({ semaforo: 'por_vencer', consumido: 0.8 });
    expect(estadoSla(base, f(2, '17:00'), CAL).semaforo).toBe('por_vencer');
    expect(estadoSla(base, f(2, '17:01'), CAL)).toMatchObject({ semaforo: 'vencido', restanteMin: -1 });
  });
  it('en espera el reloj queda detenido', () => {
    const d = { ...base, enEsperaDesde: f(2, '09:00') };
    expect(estadoSla(d, f(20, '12:00'), CAL)).toMatchObject({ semaforo: 'pausado', restanteMin: 480 });
  });
  it('cumplido congela el consumo', () => {
    expect(estadoSla({ ...base, cumplidoAt: f(2, '08:00') }, f(9, '12:00'), CAL).semaforo).toBe('cumplido');
    expect(estadoSla({ ...base, cumplidoAt: f(3, '08:00') }, f(9, '12:00'), CAL).semaforo).toBe('vencido');
  });
  it('sin vencimiento no alerta', () => {
    expect(estadoSla({ ...base, venceAt: null }, f(9, '12:00'), CAL)).toMatchObject({ semaforo: 'ok', consumido: 0 });
  });
});
