import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Persona } from '@eco/shared/schemas';
import { Avatar } from '../../componentes/insignias';
import { cn } from '../../lib/cn';

const Destino = memo(function Destino({ tecnico, arrastrando }: { tecnico: Persona | null; arrastrando: boolean }) {
  const id = tecnico?.id ?? 'ninguno';
  const { setNodeRef, isOver } = useDroppable({ id: `avatar:${id}`, data: { tipo: 'avatar', tecnico } });
  const nombre = tecnico?.nombre ?? 'Sin asignar';
  return (
    <li
      ref={setNodeRef}
      data-testid={`avatar-tecnico-${id}`}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-full border border-borde bg-superficie py-1 pr-3 pl-1 text-xs font-semibold transition-transform',
        arrastrando && 'border-dashed border-primario',
        isOver && 'scale-110 bg-primario-suave text-primario-sobre-suave',
      )}
    >
      <Avatar nombre={tecnico?.nombre ?? null} />
      <span>{arrastrando || !tecnico ? nombre : nombre.split(' ')[0]}</span>
    </li>
  );
});

export const BarraAvatares = memo(function BarraAvatares({ tecnicos, arrastrando }: { tecnicos: Persona[]; arrastrando: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-suave max-lg:sr-only">Suelte un ticket para asignarlo:</span>
      <ul aria-label="Técnicos" className="flex min-w-0 gap-2 overflow-x-auto p-1">
        {tecnicos.map((t) => (
          <Destino key={t.id} tecnico={t} arrastrando={arrastrando} />
        ))}
        <Destino tecnico={null} arrastrando={arrastrando} />
      </ul>
    </div>
  );
});
