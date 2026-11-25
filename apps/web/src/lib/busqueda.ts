/** Lectura tolerante de parámetros de la URL (sin librerías: va en el paquete inicial). */
import type { Estado, Prioridad } from '@eco/shared/dominio';

export const texto = (v: unknown) =>
  (typeof v === 'string' && v) || typeof v === 'number' ? String(v).slice(0, 200) : undefined;
export const entero = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
export const bandera = (v: unknown) => (v === true || v === 1 || v === '1' || v === 'true' ? true : undefined);
export const uno = <T extends string>(v: unknown, opciones: readonly T[]) => opciones.find((o) => o === v);
export const varios = <T extends string>(v: unknown, opciones: readonly T[]): T[] | undefined => {
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const r = opciones.filter((o) => lista.includes(o));
  return r.length ? r : undefined;
};
export const fecha = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export const ORDENES_LISTA = [
  'creadoAt',
  'actualizadoAt',
  'codigo',
  'prioridad',
  'estado',
  'venceResolucionAt',
  'titulo',
] as const;

export interface BusquedaLista {
  ambito?: 'mios' | 'area' | 'todos';
  estado?: Estado[];
  prioridad?: Prioridad[];
  areaId?: number;
  categoriaId?: number;
  asignadoId?: string;
  sinAsignar?: boolean;
  vencidos?: boolean;
  q?: string;
  orden?: (typeof ORDENES_LISTA)[number];
  dir?: 'asc' | 'desc';
  pagina?: number;
  porPagina?: number;
}
