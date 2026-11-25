import { useId } from 'react';
import { cn } from '../lib/cn';

const PETALO = 'M50 50 C37 41 28 22 36 11 C41 5 47 8 50 12 C53 8 59 5 64 11 C72 22 63 41 50 50Z';
const NERVADURAS = 'M50 46 L50 15 M47 44 L41 20 M53 44 L59 20';

/** Flor del Lapacho (flor oficial de Misiones). Decorativa salvo que reciba `titulo`. */
export function FlorLapacho({ className, animada, titulo }: { className?: string; animada?: boolean; titulo?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('flor shrink-0', animada && 'flor-animada', className)}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id={id} cx="50" cy="50" r="42" gradientUnits="userSpaceOnUse">
          <stop offset="0.1" style={{ stopColor: 'var(--flor-centro)' }} />
          <stop offset="1" style={{ stopColor: 'var(--flor-borde)' }} />
        </radialGradient>
      </defs>
      {[0, 72, 144, 216, 288].map((g) => (
        <g key={g} transform={`rotate(${g} 50 50)`}>
          <path d={PETALO} fill={`url(#${id})`} />
          <path
            d={NERVADURAS}
            fill="none"
            strokeWidth="0.9"
            strokeLinecap="round"
            opacity="0.38"
            style={{ stroke: 'var(--flor-nervadura)' }}
          />
        </g>
      ))}
      <circle cx="50" cy="50" r="5.2" style={{ fill: 'var(--flor-nervadura)' }} />
    </svg>
  );
}
