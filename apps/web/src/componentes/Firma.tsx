import { GOBIERNO, MINISTERIO, NOMBRE_PREFIJO, NOMBRE_SUFIJO } from '@eco/shared/marca';
import { cn } from '../lib/cn';
import { FlorLapacho } from './FlorLapacho';

/**
 * Firma conjunta Ministerio | Gobierno. El relleno equivale al área de seguridad del brandbook:
 * la flor y los textos no se deforman ni se recolorean.
 */
export function Firma({ compacta, className }: { compacta?: boolean; className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-3 py-1.5', className)}
      role="img"
      aria-label={`${MINISTERIO}. ${GOBIERNO}.`}
    >
      <FlorLapacho className="size-9" />
      <span aria-hidden className="flex flex-col leading-none text-firma">
        <span className="text-[0.95rem] font-medium tracking-[0.06em]">ECOLOGÍA</span>
        <span className="text-[0.95rem] font-medium tracking-[0.17em]">MISIONES</span>
      </span>
      <span aria-hidden className={cn('h-8 w-px bg-borde-fuerte', compacta && 'max-md:hidden')} />
      <span aria-hidden className={cn('text-xs leading-tight text-suave', compacta && 'max-md:hidden')}>
        Gobierno
        <br />
        de Misiones
      </span>
    </div>
  );
}

export function NombreSistema({ className }: { className?: string }) {
  return (
    <span className={cn('font-bold tracking-tight', className)}>
      <span className="text-primario">{NOMBRE_PREFIJO}</span>
      <span className="text-texto">{NOMBRE_SUFIJO}</span>
    </span>
  );
}
