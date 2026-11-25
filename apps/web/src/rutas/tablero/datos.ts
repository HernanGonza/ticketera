/** Conjuntos de datos del tablero: alimentan los gráficos, las tablas alternativas y el CSV. */
import type { Estadisticas } from '@eco/shared/schemas';
import type { Celda } from '../../lib/csv';

export interface Conjunto {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: 'lineas' | 'area' | 'barrasH' | 'calor';
  columnas: string[];
  filas: Celda[][];
  /** Columnas (índices de `filas`) que se grafican como series. */
  series: number[];
  unidad?: string;
}

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const horas = (min: number | null) => (min === null ? null : Math.round((min / 60) * 10) / 10);
const redondo = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const diaMes = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/** Matriz completa 7 × 24 (lunes primero) a partir de las celdas informadas (0 = domingo). */
export function matrizCalor(celdas: Estadisticas['mapaCalor']): number[][] {
  const m = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const c of celdas) {
    const fila = m[(c.dia + 6) % 7];
    if (fila && c.hora >= 0 && c.hora < 24) fila[c.hora] = (fila[c.hora] ?? 0) + c.total;
  }
  return m;
}

export function conjuntos(e: Estadisticas): Conjunto[] {
  const porTotal = <T extends { total: number }>(l: T[]) => [...l].sort((a, b) => b.total - a.total);
  const categorias = porTotal(e.porCategoria);
  const matriz = matrizCalor(e.mapaCalor);
  return [
    {
      id: 'semanal',
      titulo: 'Creados y resueltos por semana',
      descripcion: 'Cada punto corresponde a la semana que inicia en la fecha indicada.',
      tipo: 'lineas',
      columnas: ['Semana', 'Creados', 'Resueltos'],
      filas: e.semanal.map((s) => [diaMes(s.semana), s.creados, s.resueltos]),
      series: [1, 2],
    },
    {
      id: 'backlog',
      titulo: 'Pendientes acumulados',
      descripcion: 'Tickets abiertos al cierre de cada semana.',
      tipo: 'area',
      columnas: ['Semana', 'Abiertos'],
      filas: e.semanal.map((s) => [diaMes(s.semana), s.backlog]),
      series: [1],
    },
    {
      id: 'areas',
      titulo: 'Pedidos por área',
      descripcion: 'Áreas con más pedidos en el período.',
      tipo: 'barrasH',
      columnas: ['Área', 'Pedidos'],
      filas: porTotal(e.porArea).map((a) => [a.nombre, a.total]),
      series: [1],
    },
    {
      id: 'categorias',
      titulo: 'Pedidos por categoría',
      descripcion: 'Categorías más solicitadas en el período.',
      tipo: 'barrasH',
      columnas: ['Categoría', 'Pedidos'],
      filas: categorias.map((c) => [c.nombre, c.total]),
      series: [1],
    },
    {
      id: 'respuesta',
      titulo: 'Mediana de primera respuesta por categoría',
      descripcion: 'En horas hábiles.',
      tipo: 'barrasH',
      columnas: ['Categoría', 'Primera respuesta (h)'],
      filas: categorias.map((c) => [c.nombre, horas(c.medianaRespuestaMin)]),
      series: [1],
      unidad: ' h',
    },
    {
      id: 'resolucion',
      titulo: 'Mediana de resolución por categoría',
      descripcion: 'En horas hábiles, sin contar el tiempo en espera.',
      tipo: 'barrasH',
      columnas: ['Categoría', 'Resolución (h)'],
      filas: categorias.map((c) => [c.nombre, horas(c.medianaResolucionMin)]),
      series: [1],
      unidad: ' h',
    },
    {
      id: 'sla',
      titulo: 'Cumplimiento de plazos por categoría',
      descripcion: 'Porcentaje de tickets resueltos dentro del plazo.',
      tipo: 'barrasH',
      columnas: ['Categoría', 'Cumplimiento (%)'],
      filas: categorias.map((c) => [c.nombre, redondo(c.cumplimientoSlaPct)]),
      series: [1],
      unidad: ' %',
    },
    {
      id: 'tecnicos',
      titulo: 'Carga y resueltos por técnico',
      descripcion: 'Carga actual y tickets resueltos en el período. La calificación promedio está en la tabla.',
      tipo: 'barrasH',
      columnas: ['Técnico', 'Carga actual', 'Resueltos', 'Calificación'],
      filas: e.porTecnico.map((t) => [t.nombre, t.carga, t.resueltos, redondo(t.calificacionPromedio)]),
      series: [1, 2],
    },
    {
      id: 'calor',
      titulo: 'Ingreso de pedidos por día y hora',
      descripcion: 'Cantidad de tickets creados según día de la semana y hora local.',
      tipo: 'calor',
      columnas: ['Día', ...Array.from({ length: 24 }, (_, h) => `${h} h`)],
      filas: matriz.map((fila, i) => [DIAS[i], ...fila]),
      series: [],
    },
  ];
}

export function filasCsv(lista: readonly Conjunto[]): Celda[][] {
  return lista.flatMap((c) => [[c.titulo], c.columnas, ...c.filas, []]);
}
