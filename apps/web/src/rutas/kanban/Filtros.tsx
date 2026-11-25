import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { ETIQUETA_PRIORIDAD, PRIORIDADES, type Prioridad } from '@eco/shared/dominio';
import type { Catalogo } from '@eco/shared/schemas';
import { Boton } from '../../componentes/ui/basicos';
import { cn } from '../../lib/cn';
import { useDiferido } from '../../lib/hooks';
import type { FiltrosKanban } from '../../lib/kanban';

export const Filtros = memo(function Filtros({
  filtros,
  catalogo,
  cambiar,
  buscador,
}: {
  filtros: FiltrosKanban;
  catalogo: Catalogo | undefined;
  cambiar: (c: Partial<FiltrosKanban>) => void;
  buscador: RefObject<HTMLInputElement | null>;
}) {
  const [q, setQ] = useState(filtros.q ?? '');
  const diferido = useDiferido(q, 200);
  const enviado = useRef(filtros.q ?? '');

  useEffect(() => {
    if (diferido === enviado.current) return;
    enviado.current = diferido;
    cambiar({ q: diferido || undefined });
  }, [diferido, cambiar]);
  useEffect(() => {
    // La URL cambió por fuera (atrás/adelante o "limpiar").
    if ((filtros.q ?? '') !== enviado.current) {
      enviado.current = filtros.q ?? '';
      setQ(filtros.q ?? '');
    }
  }, [filtros.q]);

  const alternar = (clave: 'mios' | 'sinAsignar' | 'vencidos', texto: string) => (
    <button
      type="button"
      aria-pressed={!!filtros[clave]}
      data-testid={`filtro-${clave}`}
      onClick={() => cambiar({ [clave]: filtros[clave] ? undefined : true })}
      className={cn(
        'min-h-8 rounded-full border border-borde-fuerte bg-superficie px-3 text-sm font-semibold',
        filtros[clave] && 'border-primario bg-primario text-primario-texto',
      )}
    >
      {texto}
    </button>
  );
  const hay = Object.values(filtros).some((v) => v !== undefined);

  return (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search aria-hidden className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-suave" />
        <input
          ref={buscador}
          type="search"
          data-testid="kanban-buscar"
          aria-label="Buscar tickets (atajo: /)"
          aria-keyshortcuts="/"
          placeholder="Buscar…  ( / )"
          className="entrada !pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        />
      </div>
      {alternar('mios', 'Mis tickets')}
      {alternar('sinAsignar', 'Sin asignar')}
      {alternar('vencidos', 'Vencidos')}
      <select aria-label="Área" className="entrada !w-auto max-w-48" value={filtros.area ?? ''} onChange={(e) => cambiar({ area: Number(e.target.value) || undefined })}>
        <option value="">Todas las áreas</option>
        {catalogo?.areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nombre}
          </option>
        ))}
      </select>
      <select aria-label="Categoría" className="entrada !w-auto max-w-48" value={filtros.categoria ?? ''} onChange={(e) => cambiar({ categoria: Number(e.target.value) || undefined })}>
        <option value="">Todas las categorías</option>
        {catalogo?.categorias.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      <select aria-label="Prioridad" className="entrada !w-auto" value={filtros.prioridad ?? ''} onChange={(e) => cambiar({ prioridad: (e.target.value || undefined) as Prioridad | undefined })}>
        <option value="">Toda prioridad</option>
        {PRIORIDADES.map((p) => (
          <option key={p} value={p}>
            {ETIQUETA_PRIORIDAD[p]}
          </option>
        ))}
      </select>
      {hay && (
        <Boton
          variante="fantasma"
          tamano="sm"
          onClick={() =>
            cambiar({ mios: undefined, sinAsignar: undefined, vencidos: undefined, area: undefined, categoria: undefined, prioridad: undefined, q: undefined })
          }
        >
          <X aria-hidden className="size-4" /> Limpiar
        </Boton>
      )}
    </div>
  );
});
