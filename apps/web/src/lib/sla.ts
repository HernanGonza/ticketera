import {
  estadoSla,
  formatearDuracion,
  type Calendario,
  type SemaforoSla,
} from '@eco/shared/dominio';
import type { TicketResumen } from '@eco/shared/schemas';

export interface SlaTicket {
  clase: 'respuesta' | 'resolucion';
  semaforo: SemaforoSla;
  consumido: number;
  restanteMin: number;
}

const fecha = (s: string | null) => (s ? new Date(s) : null);

/**
 * SLA a mostrar: mientras falte la primera respuesta y esa meta esté más comprometida que la de
 * resolución se muestra la de respuesta; si no, la de resolución.
 */
export function slaDeTicket(t: TicketResumen, ahora: Date, cal: Calendario): SlaTicket {
  const base = { creadoAt: new Date(t.creadoAt), enEsperaDesde: fecha(t.enEsperaDesde) };
  const resolucion: SlaTicket = {
    clase: 'resolucion',
    ...estadoSla(
      { ...base, venceAt: fecha(t.venceResolucionAt), totalMin: t.slaResolucionMin, cumplidoAt: fecha(t.resueltoAt) },
      ahora,
      cal,
    ),
  };
  if (t.primeraRespuestaAt || t.resueltoAt || !t.venceRespuestaAt) return resolucion;
  const respuesta: SlaTicket = {
    clase: 'respuesta',
    ...estadoSla(
      { ...base, venceAt: fecha(t.venceRespuestaAt), totalMin: t.slaRespuestaMin, cumplidoAt: null },
      ahora,
      cal,
    ),
  };
  return respuesta.consumido > resolucion.consumido ? respuesta : resolucion;
}

export function textoSla(s: SlaTicket): string {
  const meta = s.clase === 'respuesta' ? 'Respuesta' : 'Resolución';
  switch (s.semaforo) {
    case 'vencido':
      return `${meta} vencida hace ${formatearDuracion(s.restanteMin)}`;
    case 'pausado':
      return `${meta} en pausa`;
    case 'cumplido':
      return `${meta} cumplida a tiempo`;
    default:
      return `${meta}: quedan ${formatearDuracion(s.restanteMin)}`;
  }
}
