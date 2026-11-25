import { ETIQUETA_ESTADO, ETIQUETA_PRIORIDAD, type Estado, type Prioridad } from '@eco/shared/dominio';
import type { CampoExtra, TicketEvento } from '@eco/shared/schemas';

export function describirEvento(e: TicketEvento): string {
  const quien = e.usuario?.nombre ?? 'El sistema';
  const estado = (v: string | null) => ETIQUETA_ESTADO[v as Estado] ?? v ?? '—';
  const prioridad = (v: string | null) => ETIQUETA_PRIORIDAD[v as Prioridad] ?? v ?? '—';
  switch (e.tipo) {
    case 'creado':
      return `${quien} creó el pedido`;
    case 'estado':
      return `${quien} cambió el estado de ${estado(e.de)} a ${estado(e.a)}`;
    case 'asignacion':
      return e.a ? `${quien} asignó el pedido a ${e.aTexto ?? 'un técnico'}` : `${quien} quitó la asignación`;
    case 'prioridad':
      return `${quien} cambió la prioridad de ${prioridad(e.de)} a ${prioridad(e.a)}`;
    case 'categoria':
      return `${quien} cambió la categoría a ${e.aTexto ?? 'otra'}`;
    case 'primera_respuesta':
      return `Primera respuesta de ${quien}`;
    case 'reabierto':
      return `${quien} reabrió el pedido`;
    case 'calificacion':
      return `${quien} calificó la atención${e.a ? ` con ${e.a} de 5` : ''}`;
    case 'sla_por_vencer':
      return 'El plazo de atención está por vencer';
    case 'sla_vencido':
      return 'Venció el plazo de atención';
  }
}

export function formatearDato(campo: CampoExtra | undefined, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (v === null || v === undefined || v === '') return '—';
  if (campo?.tipo === 'fecha' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return v.split('-').reverse().join('/');
  return String(v);
}
