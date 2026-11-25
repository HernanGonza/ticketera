import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { FlorLapacho } from '../FlorLapacho';

export const estilosBoton = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variante: {
        primario: 'bg-primario text-primario-texto hover:bg-primario-fuerte',
        secundario: 'border border-borde-fuerte bg-superficie text-texto hover:bg-superficie-2',
        fantasma: 'text-texto hover:bg-superficie-2',
        acento: 'bg-acento text-acento-texto hover:opacity-90',
        peligro: 'bg-peligro text-peligro-texto hover:opacity-90',
      },
      tamano: {
        sm: 'min-h-8 px-2.5 text-sm',
        md: 'min-h-10 px-4 text-sm',
        lg: 'min-h-12 px-5 text-base',
        icono: 'size-10',
        iconoSm: 'size-8',
      },
    },
    defaultVariants: { variante: 'primario', tamano: 'md' },
  },
);

type PropsBoton = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof estilosBoton> & { ocupado?: boolean };

export const Boton = forwardRef<HTMLButtonElement, PropsBoton>(function Boton(
  { className, variante, tamano, ocupado, disabled, children, type = 'button', ...p },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(estilosBoton({ variante, tamano }), className)}
      disabled={disabled || ocupado}
      aria-busy={ocupado || undefined}
      {...p}
    >
      {ocupado && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
});

/** Etiqueta, control, ayuda y error asociados correctamente. */
export function Campo({
  etiqueta,
  error,
  ayuda,
  requerido,
  className,
  children,
}: {
  etiqueta: ReactNode;
  error?: string;
  ayuda?: string;
  requerido?: boolean;
  className?: string;
  children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; 'aria-required'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const desc = [ayuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {etiqueta}
        {requerido && (
          <span aria-hidden className="text-peligro">
            {' '}
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': desc || undefined,
        'aria-required': requerido || undefined,
      })}
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-xs text-suave">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…', className }: { texto?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex min-h-60 flex-col items-center justify-center gap-3 text-suave', className)}>
      <FlorLapacho animada className="size-14" />
      <span className="text-sm">{texto}</span>
    </div>
  );
}

export function Esqueletos({ filas = 4, alto = 'h-16', className }: { filas?: number; alto?: string; className?: string }) {
  return (
    <div role="status" aria-label="Cargando" className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className={cn('esqueleto', alto)} />
      ))}
    </div>
  );
}

export function EstadoVacio({ titulo, children, className }: { titulo: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      <FlorLapacho animada className="mb-2 size-20" />
      <h2>{titulo}</h2>
      {children && <div className="max-w-md text-sm text-suave">{children}</div>}
    </div>
  );
}

export function ErrorVista({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  const noEncontrado = (error as { status?: number } | null)?.status === 404;
  return (
    <div role="alert">
      <EstadoVacio titulo={noEncontrado ? 'No encontramos lo que busca' : 'Algo no salió bien'}>
        <p>
          {noEncontrado
            ? 'Es posible que no exista o que usted no tenga acceso.'
            : error instanceof Error
              ? error.message
              : 'Ocurrió un error inesperado.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {reintentar && !noEncontrado && <Boton onClick={reintentar}>Reintentar</Boton>}
          <a href="/" className={estilosBoton({ variante: 'secundario' })}>
            Ir al inicio
          </a>
        </div>
      </EstadoVacio>
    </div>
  );
}

export function Encabezado({ titulo, children, acciones }: { titulo: string; children?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{titulo}</h1>
        {children && <p className="text-sm text-suave">{children}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </header>
  );
}

export function Paginador({
  pagina,
  porPagina,
  total,
  cambiar,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  cambiar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <span className="text-suave">
        {total === 0 ? 'Sin resultados' : `Página ${pagina} de ${paginas} · ${total} resultado${total === 1 ? '' : 's'}`}
      </span>
      <div className="flex gap-2">
        <Boton variante="secundario" tamano="sm" disabled={pagina <= 1} onClick={() => cambiar(pagina - 1)}>
          Anterior
        </Boton>
        <Boton variante="secundario" tamano="sm" disabled={pagina >= paginas} onClick={() => cambiar(pagina + 1)}>
          Siguiente
        </Boton>
      </div>
    </nav>
  );
}
