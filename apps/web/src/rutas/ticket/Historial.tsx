import { useQuery } from '@tanstack/react-query';
import { formatearFechaHora } from '@eco/shared/dominio';
import { Esqueletos } from '../../componentes/ui/basicos';
import { qEventos } from '../../lib/consultas';
import { describirEvento } from '../../lib/historial';

export function Historial({ ticketId }: { ticketId: string }) {
  const { data, isPending } = useQuery(qEventos(ticketId));
  return (
    <details className="tarjeta p-4">
      <summary className="font-bold">Historial completo{data ? ` (${data.items.length})` : ''}</summary>
      {isPending ? (
        <Esqueletos filas={3} alto="h-8" className="mt-3" />
      ) : (
        <ol className="mt-3 flex flex-col gap-2 border-l-2 border-borde pl-3 text-sm">
          {data?.items.map((e) => (
            <li key={e.id}>
              <p>{describirEvento(e)}</p>
              <time dateTime={e.fecha} className="text-xs text-suave">
                {formatearFechaHora(e.fecha)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
