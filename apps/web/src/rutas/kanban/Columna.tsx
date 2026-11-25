import { memo, useCallback, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ETIQUETA_ESTADO, DIAS_CERRADOS_KANBAN, type Calendario, type Estado, type Rol } from '@eco/shared/dominio';
import type { Persona, TicketResumen } from '@eco/shared/schemas';
import { cn } from '../../lib/cn';
import { TarjetaArrastrable, type AccionesTarjeta } from './Tarjeta';

interface Props {
  estado: Estado;
  tickets: TicketResumen[];
  /** null = no hay arrastre en curso */
  valida: boolean | null;
  /** Tarjeta que se está arrastrando: debe seguir montada aunque salga de la vista. */
  activoId: string | null;
  ahora: Date;
  calendario: Calendario;
  noLeidos: Record<string, number> | undefined;
  menu: { acciones: AccionesTarjeta; tecnicos: Persona[]; rol: Rol };
}

export const Columna = memo(function Columna({ estado, tickets, valida, activoId, ahora, calendario, noLeidos, menu }: Props) {
  const soltar = useDroppable({ id: `col:${estado}`, data: { tipo: 'columna', estado }, disabled: valida === false });
  const caja = useRef<HTMLDivElement>(null);
  const fijo = activoId ? tickets.findIndex((t) => t.id === activoId) : -1;
  const rango = useCallback(
    (r: Range) => {
      const base = defaultRangeExtractor(r);
      return fijo < 0 || base.includes(fijo) ? base : [...base, fijo].sort((a, b) => a - b);
    },
    [fijo],
  );
  const virtual = useVirtualizer({
    count: tickets.length,
    getScrollElement: () => caja.current,
    estimateSize: () => 142,
    getItemKey: (i) => tickets[i]!.id,
    rangeExtractor: rango,
    overscan: 3,
    gap: 8,
    initialRect: { width: 288, height: 600 },
  });
  return (
    <section
      ref={soltar.setNodeRef}
      data-testid={`columna-${estado}`}
      data-valida={valida ?? undefined}
      aria-label={`${ETIQUETA_ESTADO[estado]}: ${tickets.length} tickets`}
      className={cn(
        'flex h-full w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-lg border border-borde bg-superficie-2 sm:w-72',
        valida === false && 'opacity-40',
        valida && 'border-dashed border-primario',
        soltar.isOver && 'bg-primario-suave',
      )}
    >
      <header className="flex items-center gap-2 border-b-2 px-3 py-2" style={{ borderColor: `var(--estado-${estado})` }}>
        <h2 className="text-sm">{ETIQUETA_ESTADO[estado]}</h2>
        <span className="rounded-full bg-superficie px-2 text-xs font-bold">{tickets.length}</span>
        {estado === 'cerrado' && <span className="ml-auto text-xs text-suave">últimos {DIAS_CERRADOS_KANBAN} días</span>}
      </header>
      <div ref={caja} className="min-h-0 flex-1 overflow-y-auto p-2" style={{ contain: 'strict' }}>
        {!tickets.length && <p className="py-6 text-center text-xs text-suave">Sin tickets</p>}
        <ul className="relative w-full" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((v) => {
            const t = tickets[v.index]!;
            return (
              <li
                key={t.id}
                data-index={v.index}
                ref={virtual.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${v.start}px)` }}
              >
                <TarjetaArrastrable
                  ticket={t}
                  columna={estado}
                  valida={valida !== false}
                  ahora={ahora}
                  calendario={calendario}
                  noLeidos={noLeidos?.[t.id] ?? 0}
                  menu={menu}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
});
