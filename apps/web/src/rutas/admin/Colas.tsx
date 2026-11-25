import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatearFechaHora } from '@eco/shared/dominio';
import type { ResumenCola, Trabajo } from '@eco/shared/schemas';
import { Boton, Encabezado, ErrorVista, Esqueletos, EstadoVacio } from '../../componentes/ui/basicos';
import { api, aQuery } from '../../lib/api';
import { claves } from '../../lib/consultas';
import { cn } from '../../lib/cn';

const REFRESCO = 5000;
const ESTADOS: Record<Trabajo['estado'], string> = {
  created: 'Pendiente',
  retry: 'Reintento',
  active: 'Activo',
  completed: 'Completado',
  cancelled: 'Cancelado',
  failed: 'Fallido',
};

export function Colas() {
  const [cola, setCola] = useState<string>();
  const [estado, setEstado] = useState('');
  const resumen = useQuery({
    queryKey: claves.colas,
    queryFn: ({ signal }) => api<{ items: ResumenCola[] }>('/api/admin/colas', { signal }),
    refetchInterval: REFRESCO,
  });
  const elegida = cola ?? resumen.data?.items[0]?.nombre;
  if (resumen.isPending) return <Esqueletos filas={6} alto="h-14" />;
  if (!resumen.data) return <ErrorVista error={resumen.error} reintentar={() => void resumen.refetch()} />;
  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado titulo="Colas de trabajo">Se actualiza cada {REFRESCO / 1000} segundos.</Encabezado>
      {!resumen.data.items.length ? (
        <EstadoVacio titulo="No hay colas registradas">El proceso de tareas en segundo plano todavía no se inició.</EstadoVacio>
      ) : (
        <div className="tarjeta mb-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Resumen por cola">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borde bg-superficie-2 text-left">
                {['Cola', 'Pendientes', 'Activos', 'Completados', 'Fallidos', 'Cancelados'].map((t) => (
                  <th key={t} scope="col" className="p-2 font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resumen.data.items.map((c) => (
                <tr key={c.nombre} data-testid={`cola-${c.nombre}`} className={cn('border-b border-borde last:border-0', c.nombre === elegida && 'bg-primario-suave text-primario-sobre-suave')}>
                  <th scope="row" className="p-2 text-left">
                    <button type="button" className="font-bold underline" aria-pressed={c.nombre === elegida} onClick={() => setCola(c.nombre)}>
                      {c.nombre}
                    </button>
                  </th>
                  <td className="p-2">{c.pendientes}</td>
                  <td className="p-2">{c.activos}</td>
                  <td className="p-2">{c.completados}</td>
                  <td className={cn('p-2', c.fallidos > 0 && 'font-bold text-peligro')}>{c.fallidos}</td>
                  <td className="p-2">{c.cancelados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {elegida && <Trabajos cola={elegida} estado={estado} cambiarEstado={setEstado} />}
    </div>
  );
}

function Trabajos({ cola, estado, cambiarEstado }: { cola: string; estado: string; cambiarEstado: (e: string) => void }) {
  const qc = useQueryClient();
  const trabajos = useQuery({
    queryKey: [...claves.colas, cola, estado],
    queryFn: ({ signal }) =>
      api<{ items: Trabajo[] }>(`/api/admin/colas/${encodeURIComponent(cola)}/trabajos${aQuery({ estado, limite: 50 })}`, { signal }),
    refetchInterval: REFRESCO,
  });
  const actuar = useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: 'reintentar' | 'cancelar' }) =>
      api(`/api/admin/colas/${encodeURIComponent(cola)}/trabajos/${id}/${accion}`, { metodo: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: claves.colas }),
  });
  return (
    <section aria-label={`Trabajos de ${cola}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2>Trabajos de «{cola}»</h2>
        <select aria-label="Estado de los trabajos" className="entrada !w-auto" value={estado} onChange={(e) => cambiarEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {trabajos.isPending ? (
        <Esqueletos filas={4} alto="h-12" />
      ) : !trabajos.data?.items.length ? (
        <p className="tarjeta p-6 text-center text-sm text-suave">No hay trabajos para mostrar.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {trabajos.data.items.map((t) => (
            <li key={t.id} className="tarjeta flex flex-wrap items-start gap-2 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p>
                  <strong className={cn(t.estado === 'failed' && 'text-peligro')}>{ESTADOS[t.estado]}</strong> · intento {t.intentos} de {t.maxIntentos} ·{' '}
                  {formatearFechaHora(t.creadoAt)}
                  {t.finalizadoAt && ` → ${formatearFechaHora(t.finalizadoAt)}`}
                </p>
                <details>
                  <summary className="text-xs text-suave">Datos y resultado ({t.id})</summary>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-superficie-2 p-2 text-xs">
                    {JSON.stringify({ datos: t.datos, salida: t.salida }, null, 2)}
                  </pre>
                </details>
              </div>
              {(t.estado === 'failed' || t.estado === 'cancelled') && (
                <Boton variante="secundario" tamano="sm" onClick={() => actuar.mutate({ id: t.id, accion: 'reintentar' })}>
                  Reintentar
                </Boton>
              )}
              {(t.estado === 'created' || t.estado === 'retry' || t.estado === 'active') && (
                <Boton variante="fantasma" tamano="sm" onClick={() => actuar.mutate({ id: t.id, accion: 'cancelar' })}>
                  Cancelar
                </Boton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
