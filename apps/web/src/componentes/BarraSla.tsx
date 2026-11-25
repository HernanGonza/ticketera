import type { Calendario } from '@eco/shared/dominio';
import type { TicketResumen } from '@eco/shared/schemas';
import { slaDeTicket, textoSla } from '../lib/sla';

/** Consumo del SLA: color por semáforo y siempre con texto. */
export function BarraSla({ ticket, ahora, calendario }: { ticket: TicketResumen; ahora: Date; calendario: Calendario }) {
  if (!ticket.venceResolucionAt || ticket.estado === 'cancelado') return null;
  const s = slaDeTicket(ticket, ahora, calendario);
  const pct = Math.round(Math.min(1, s.consumido) * 100);
  const texto = textoSla(s);
  return (
    <div data-sla={s.semaforo}>
      <div
        role="meter"
        aria-label="Plazo consumido"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={texto}
        className="h-1.5 overflow-hidden rounded-full bg-superficie-2"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${s.semaforo === 'vencido' ? 100 : pct}%`, background: `var(--sla-${s.semaforo})` }}
        />
      </div>
      <p className="mt-0.5 text-[0.7rem] text-suave">{texto}</p>
    </div>
  );
}
