import { ZONA_HORARIA } from '../marca';

const fechaHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partes(d: Date | string) {
  const p: Record<string, string> = {};
  for (const x of fechaHora.formatToParts(new Date(d))) p[x.type] = x.value;
  return p;
}
/** dd/mm/aaaa HH:mm */
export function formatearFechaHora(d: Date | string): string {
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
/** dd/mm/aaaa */
export function formatearFecha(d: Date | string): string {
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year}`;
}
/** "45 min", "3 h 20 min", "2 d 4 h" */
export function formatearDuracion(minutos: number): string {
  const m = Math.abs(Math.round(minutos));
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const r = m % 60;
    return r ? `${Math.floor(m / 60)} h ${r} min` : `${m / 60} h`;
  }
  const h = Math.floor((m % 1440) / 60);
  return h ? `${Math.floor(m / 1440)} d ${h} h` : `${Math.floor(m / 1440)} d`;
}
export function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
