import { memo } from 'react';
import { ChevronDown, ChevronUp, ChevronsUp, Equal } from 'lucide-react';
import { ETIQUETA_ESTADO, ETIQUETA_PRIORIDAD, iniciales, type Estado, type Prioridad } from '@eco/shared/dominio';
import { cn } from '../lib/cn';

const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap';

export function InsigniaEstado({ estado, className, ...p }: { estado: Estado; className?: string; 'data-testid'?: string }) {
  return (
    <span
      {...p}
      data-estado={estado}
      className={cn(base, className)}
      style={{ background: `var(--estado-${estado}-fondo)`, color: `var(--estado-${estado}-texto)` }}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

const ICONO_PRIORIDAD = { baja: ChevronDown, media: Equal, alta: ChevronUp, critica: ChevronsUp };

export function InsigniaPrioridad({ prioridad }: { prioridad: Prioridad }) {
  const I = ICONO_PRIORIDAD[prioridad];
  return (
    <span
      className={base}
      style={{ background: `var(--prioridad-${prioridad}-fondo)`, color: `var(--prioridad-${prioridad}-texto)` }}
    >
      <I aria-hidden className="size-3.5" />
      <span className="sr-only">Prioridad </span>
      {ETIQUETA_PRIORIDAD[prioridad]}
    </span>
  );
}

const TONOS = [
  'bg-primario-suave text-primario-sobre-suave',
  'bg-acento-suave text-acento-sobre-suave',
  'bg-aviso-suave text-aviso-sobre-suave',
  'bg-exito-suave text-exito-sobre-suave',
  'bg-peligro-suave text-peligro-sobre-suave',
];

export const Avatar = memo(function Avatar({ nombre, className }: { nombre: string | null; className?: string }) {
  let h = 0;
  for (const c of nombre ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      title={nombre ?? 'Sin asignar'}
      role="img"
      aria-label={nombre ?? 'Sin asignar'}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold',
        nombre ? TONOS[h % TONOS.length] : 'border border-dashed border-borde-fuerte text-suave',
        className,
      )}
    >
      {nombre ? iniciales(nombre) : '—'}
    </span>
  );
});

export function Contador({ n, etiqueta, className }: { n: number; etiqueta: string; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-acento px-1.5 text-[0.7rem] leading-5 font-bold text-acento-texto',
        className,
      )}
    >
      <span aria-hidden>{n > 99 ? '99+' : n}</span>
      <span className="sr-only">
        {n} {etiqueta}
      </span>
    </span>
  );
}
