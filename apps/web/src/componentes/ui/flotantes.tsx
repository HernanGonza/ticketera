/**
 * Diálogos, menús y paneles flotantes. Los diálogos usan `<dialog>` nativo (foco atrapado y fondo
 * inerte); los menús son livianos para no engordar la carga inicial.
 */
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as TeclaReact,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

interface PropsModal {
  cerrar: () => void;
  titulo: string;
  descripcion?: string;
  children: ReactNode;
  className?: string;
}

function Modal({ cerrar, titulo, descripcion, children, className, lateral }: PropsModal & { lateral?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current!;
    const previo = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    return () => {
      d.close();
      previo?.focus?.();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={descripcion ? `${id}-d` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        cerrar();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && cerrar()}
      className={cn(
        'overflow-y-auto border-borde bg-superficie p-0 text-texto shadow-alta backdrop:bg-velo',
        lateral
          ? 'm-0 h-dvh max-h-dvh w-[min(85vw,18rem)] border-r'
          : 'm-auto max-h-[92dvh] w-[min(94vw,32rem)] rounded-xl border',
        className,
      )}
    >
      <div className={lateral ? 'flex min-h-full flex-col gap-3 p-4' : 'p-5'}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={`${id}-t`} className="text-lg font-bold">
            {titulo}
          </h2>
          <button type="button" className="rounded-md p-1 hover:bg-superficie-2" aria-label={lateral ? 'Cerrar menú' : 'Cerrar'} onClick={cerrar}>
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {descripcion && (
          <p id={`${id}-d`} className="mb-3 text-sm text-suave">
            {descripcion}
          </p>
        )}
        {children}
      </div>
    </dialog>,
    document.body,
  );
}

export function Dialogo({ abierto, ...p }: PropsModal & { abierto: boolean }) {
  return abierto ? <Modal {...p} /> : null;
}

/** Panel lateral para el menú en pantallas chicas. */
export function Cajon({ abierto, ...p }: PropsModal & { abierto: boolean }) {
  return abierto ? <Modal {...p} lateral /> : null;
}

/** Posición, apertura y cierre comunes de menús y paneles. */
function useFlotante(alinear: 'start' | 'end') {
  const [abierto, setAbierto] = useState(false);
  const disparador = useRef<HTMLElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const cerrar = useCallback((enfocar = true) => {
    setAbierto(false);
    if (enfocar) disparador.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const d = disparador.current;
    const c = contenido.current;
    if (!abierto || !d || !c) return;
    const ubicar = () => {
      const r = d.getBoundingClientRect();
      const margen = 8;
      const abajo = innerHeight - r.bottom - margen;
      const arriba = r.top - margen;
      const haciaArriba = abajo < Math.min(c.scrollHeight, 240) && arriba > abajo;
      c.style.maxHeight = `${Math.max(120, Math.min(haciaArriba ? arriba : abajo, 420))}px`;
      const alto = c.offsetHeight;
      const x = alinear === 'end' ? r.right - c.offsetWidth : r.left;
      c.style.left = `${Math.max(margen, Math.min(x, innerWidth - c.offsetWidth - margen))}px`;
      c.style.top = `${haciaArriba ? r.top - alto - 4 : r.bottom + 4}px`;
      c.style.visibility = 'visible';
    };
    ubicar();
    const observador = new ResizeObserver(ubicar);
    observador.observe(c);
    (c.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled), button:not(:disabled), a') ?? c).focus();
    const fuera = (e: Event) => {
      const n = e.target as Node;
      if (!c.contains(n) && !d.contains(n)) setAbierto(false);
    };
    const mover = (e: Event) => !c.contains(e.target as Node) && ubicar();
    document.addEventListener('pointerdown', fuera, true);
    window.addEventListener('resize', ubicar);
    window.addEventListener('scroll', mover, true);
    return () => {
      observador.disconnect();
      document.removeEventListener('pointerdown', fuera, true);
      window.removeEventListener('resize', ubicar);
      window.removeEventListener('scroll', mover, true);
    };
  }, [abierto, alinear]);

  const activador = (el: ReactElement, tipo: 'menu' | 'dialog') =>
    cloneElement(el as ReactElement<Record<string, unknown> & { ref?: Ref<HTMLElement> }>, {
      ref: disparador,
      'aria-haspopup': tipo,
      'aria-expanded': abierto,
      onClick: () => setAbierto((a) => !a),
    });
  const portal = (n: ReactNode) =>
    abierto ? createPortal(n, disparador.current?.closest('dialog') ?? document.body) : null;
  return { activador, portal, contenido, cerrar };
}

const CerrarMenu = createContext<(enfocar?: boolean) => void>(() => {});

function navegarMenu(e: TeclaReact<HTMLDivElement>, cerrar: (enfocar?: boolean) => void) {
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    cerrar();
    return;
  }
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const destino =
    e.key === 'ArrowDown' ? (i + 1) % items.length
    : e.key === 'ArrowUp' ? (i - 1 + items.length) % items.length
    : e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : -1;
  if (destino < 0) return;
  e.preventDefault();
  items[destino]?.focus();
}

const claseItem =
  'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-none select-none disabled:opacity-50 enabled:hover:bg-primario-suave enabled:hover:text-primario-sobre-suave focus:bg-primario-suave focus:text-primario-sobre-suave';

export function Menu({ disparador, children, alinear = 'end' }: { disparador: ReactElement; children: ReactNode; alinear?: 'start' | 'end' }) {
  const f = useFlotante(alinear);
  return (
    <>
      {f.activador(disparador, 'menu')}
      {f.portal(
        <CerrarMenu.Provider value={f.cerrar}>
          <div
            ref={f.contenido}
            role="menu"
            tabIndex={-1}
            onKeyDown={(e) => navegarMenu(e, f.cerrar)}
            className="invisible fixed z-50 max-w-[92vw] min-w-48 overflow-y-auto rounded-md border border-borde bg-superficie p-1 text-texto shadow-alta"
          >
            {children}
          </div>
        </CerrarMenu.Provider>,
      )}
    </>
  );
}
export function ItemMenu({ children, alElegir, disabled }: { children: ReactNode; alElegir: () => void; disabled?: boolean }) {
  const cerrar = useContext(CerrarMenu);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={claseItem}
      disabled={disabled}
      onClick={() => {
        cerrar();
        alElegir();
      }}
    >
      {children}
    </button>
  );
}
export function CasillaMenu({ children, marcada, cambiar }: { children: ReactNode; marcada: boolean; cambiar: (v: boolean) => void }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={marcada} tabIndex={-1} className={claseItem} onClick={() => cambiar(!marcada)}>
      <span aria-hidden className="inline-block w-4">
        {marcada ? '✓' : ''}
      </span>
      {children}
    </button>
  );
}
export const TituloMenu = ({ children }: { children: ReactNode }) => (
  <div role="presentation" className="px-2.5 py-1 text-xs font-semibold text-suave">
    {children}
  </div>
);
export const SeparadorMenu = () => <div role="separator" className="my-1 h-px bg-borde" />;

export function Panel({ disparador, children, className }: { disparador: ReactElement; children: (cerrar: () => void) => ReactNode; className?: string }) {
  const f = useFlotante('end');
  return (
    <>
      {f.activador(disparador, 'dialog')}
      {f.portal(
        <div
          ref={f.contenido}
          role="dialog"
          tabIndex={-1}
          onKeyDown={(e) => e.key === 'Escape' && f.cerrar()}
          className={cn(
            'invisible fixed z-50 flex w-[min(92vw,22rem)] flex-col overflow-y-auto rounded-lg border border-borde bg-superficie text-texto shadow-alta',
            className,
          )}
        >
          {children(() => f.cerrar(false))}
        </div>,
      )}
    </>
  );
}
