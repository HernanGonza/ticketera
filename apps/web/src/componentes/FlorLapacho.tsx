import { cn } from '../lib/cn';

/**
 * Flor del Lapacho (flor oficial de Misiones), con el vector del brandbook (pág. 8): no se redibuja ni se
 * recolorea. Decorativa salvo que reciba `titulo`.
 */
export function FlorLapacho({ className, animada, titulo }: { className?: string; animada?: boolean; titulo?: string }) {
  return (
    <img
      src="/marca/flor.svg"
      alt={titulo ?? ''}
      width={134}
      height={134}
      className={cn('flor shrink-0', animada && 'flor-animada', className)}
    />
  );
}
