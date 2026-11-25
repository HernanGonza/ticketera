/** Lógica pura del tablero: agrupado, orden optimista, destino de un arrastre y filtros. */
import { COLUMNAS_KANBAN, esAbierto, requiereAsignado, type Calendario, type Estado, type Prioridad } from '@eco/shared/dominio';
import type { Persona, TicketResumen } from '@eco/shared/schemas';
import type { Parche } from './cache';
import { slaDeTicket } from './sla';

export type Columnas = Record<Estado, TicketResumen[]>;

const comparar = (a: TicketResumen, b: TicketResumen) =>
  a.ordenKanban - b.ordenKanban || a.codigo.localeCompare(b.codigo);

export function agrupar(tickets: readonly TicketResumen[]): Columnas {
  const c = Object.fromEntries([...COLUMNAS_KANBAN, 'cancelado'].map((e) => [e, []])) as unknown as Columnas;
  for (const t of tickets) c[t.estado].push(t);
  for (const e of COLUMNAS_KANBAN) c[e].sort(comparar);
  return c;
}

export interface Vecinos {
  antesDeId: string | null;
  despuesDeId: string | null;
}

/**
 * Vecinos de la posición donde se suelta. `sobreId` es la tarjeta bajo el puntero (null = la columna,
 * es decir al final). Dentro de la misma columna, al bajar queda debajo de `sobreId`; si no, encima.
 * Devuelve null cuando no hay cambio de posición.
 */
export function calcularVecinos(ids: readonly string[], activoId: string, sobreId: string | null): Vecinos | null {
  const origen = ids.indexOf(activoId);
  if (sobreId === activoId) return null;
  const resto = ids.filter((i) => i !== activoId);
  let pos = resto.length;
  if (sobreId !== null) {
    const destino = resto.indexOf(sobreId);
    if (destino >= 0) pos = origen >= 0 && origen < ids.indexOf(sobreId) ? destino + 1 : destino;
  }
  if (origen >= 0 && pos === origen) return null;
  return { despuesDeId: resto[pos - 1] ?? null, antesDeId: resto[pos] ?? null };
}

/** Orden provisorio hasta que responda el servidor (columna ordenada en forma ascendente). */
export function ordenProvisional(columna: readonly TicketResumen[], v: Vecinos): number {
  const arriba = columna.find((t) => t.id === v.despuesDeId)?.ordenKanban;
  const abajo = columna.find((t) => t.id === v.antesDeId)?.ordenKanban;
  if (arriba !== undefined && abajo !== undefined) return (arriba + abajo) / 2;
  if (arriba !== undefined) return arriba + 1;
  if (abajo !== undefined) return abajo - 1;
  return (columna[0]?.ordenKanban ?? 1) - 1;
}

/** Cambios visibles inmediatos al cambiar de estado (el servidor tiene la última palabra). */
export function parcheDeEstado(t: TicketResumen, estado: Estado, yo: Persona, ahora = new Date()): Parche {
  if (estado === t.estado) return {};
  const p: Parche = { estado };
  if (requiereAsignado(estado) && !t.asignado) p.asignado = yo;
  p.enEsperaDesde = estado === 'en_espera' ? ahora.toISOString() : null;
  if (estado === 'resuelto') p.resueltoAt = ahora.toISOString();
  else if (t.estado === 'resuelto' && estado !== 'cerrado') p.resueltoAt = null;
  return p;
}

export interface FiltrosKanban {
  mios?: boolean;
  sinAsignar?: boolean;
  vencidos?: boolean;
  area?: number;
  categoria?: number;
  prioridad?: Prioridad;
  q?: string;
}

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function estaVencido(t: TicketResumen, ahora: Date, cal: Calendario): boolean {
  return esAbierto(t.estado) && slaDeTicket(t, ahora, cal).semaforo === 'vencido';
}

export function filtrarTickets(
  tickets: readonly TicketResumen[],
  f: FiltrosKanban,
  yoId: string,
  ahora: Date,
  cal: Calendario,
): TicketResumen[] {
  const q = f.q ? normalizar(f.q.trim()) : '';
  return tickets.filter(
    (t) =>
      (!f.mios || t.asignado?.id === yoId) &&
      (!f.sinAsignar || !t.asignado) &&
      (!f.area || t.areaId === f.area) &&
      (!f.categoria || t.categoriaId === f.categoria) &&
      (!f.prioridad || t.prioridad === f.prioridad) &&
      (!q ||
        normalizar(`${t.codigo} ${t.titulo} ${t.solicitante.nombre} ${t.areaNombre ?? ''}`).includes(q)) &&
      (!f.vencidos || estaVencido(t, ahora, cal)),
  );
}

