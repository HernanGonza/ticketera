import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Adjunto } from '@eco/shared/schemas';
import { api } from '../lib/api';
import { archivosPegados, esImagen, formatearBytes, separarPorTamano } from '../lib/adjuntos';
import { cn } from '../lib/cn';
import { Boton } from './ui/basicos';
import { Dialogo } from './ui/flotantes';

export function agregarArchivos(actuales: File[], nuevos: File[], maxMb: number): File[] {
  const { aceptados, rechazados } = separarPorTamano(nuevos, maxMb);
  for (const r of rechazados)
    toast.error(`«${r.name}» ${r.size === 0 ? 'está vacío' : `supera el máximo de ${maxMb} MB`}.`);
  return [...actuales, ...aceptados];
}

/**
 * Sube los archivos de a uno. Los que fallan se avisan con un botón para reintentarlos.
 * `listo` se llama después de cada tanda para refrescar la pantalla.
 */
export async function subirArchivos(url: string, archivos: File[], listo: () => void): Promise<void> {
  const fallidos: File[] = [];
  let motivo = '';
  for (const f of archivos) {
    const datos = new FormData();
    datos.append('archivo', f);
    try {
      await api<Adjunto>(url, { metodo: 'POST', cuerpo: datos });
    } catch (e) {
      fallidos.push(f);
      motivo = e instanceof Error ? e.message : '';
    }
  }
  listo();
  if (!fallidos.length) return;
  toast.error(`No se pudo adjuntar: ${fallidos.map((f) => f.name).join(', ')}.`, {
    description: motivo,
    duration: Infinity,
    action: { label: 'Reintentar', onClick: () => void subirArchivos(url, fallidos, listo) },
  });
}

export function ListaArchivos({ archivos, quitar }: { archivos: File[]; quitar: (i: number) => void }) {
  const vistas = useMemo(
    () => archivos.map((f) => (esImagen(f.type) ? URL.createObjectURL(f) : null)),
    [archivos],
  );
  useEffect(() => () => vistas.forEach((u) => u && URL.revokeObjectURL(u)), [vistas]);
  if (!archivos.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Archivos para adjuntar">
      {archivos.map((f, i) => (
        <li key={`${f.name}-${i}`} className="tarjeta flex items-center gap-2 p-1.5 pr-1">
          {vistas[i] ? (
            <img src={vistas[i]} alt="" className="size-12 rounded-sm object-cover" />
          ) : (
            <FileText aria-hidden className="mx-3 size-6 text-suave" />
          )}
          <span className="max-w-40 text-xs">
            <span className="block truncate font-semibold">{f.name}</span>
            <span className="text-suave">{formatearBytes(f.size)}</span>
          </span>
          <Boton variante="fantasma" tamano="iconoSm" aria-label={`Quitar ${f.name}`} onClick={() => quitar(i)}>
            <X aria-hidden className="size-4" />
          </Boton>
        </li>
      ))}
    </ul>
  );
}

/** Botón para adjuntar; también admite arrastrar archivos y pegar capturas (Ctrl+V en toda la pantalla). */
export function ZonaAdjuntos({ archivos, cambiar, maxMb }: { archivos: File[]; cambiar: (a: File[]) => void; maxMb: number }) {
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const ref = useRef({ archivos, cambiar, maxMb });
  ref.current = { archivos, cambiar, maxMb };

  useEffect(() => {
    const pegar = (e: ClipboardEvent) => {
      const f = archivosPegados(e.clipboardData);
      if (!f.length) return;
      e.preventDefault();
      const r = ref.current;
      r.cambiar(agregarArchivos(r.archivos, f, r.maxMb));
    };
    window.addEventListener('paste', pegar);
    return () => window.removeEventListener('paste', pegar);
  }, []);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEncima(false);
        cambiar(agregarArchivos(archivos, Array.from(e.dataTransfer.files), maxMb));
      }}
      className={cn(
        'flex flex-col gap-2 rounded-lg border-2 border-dashed border-transparent',
        encima && 'border-primario bg-primario-suave text-primario-sobre-suave',
      )}
    >
      <ListaArchivos archivos={archivos} quitar={(i) => cambiar(archivos.filter((_, j) => j !== i))} />
      <Boton
        variante="secundario"
        tamano="sm"
        className="self-start"
        title={`Hasta ${maxMb} MB por archivo. También puede arrastrarlos o pegar una captura con Ctrl+V.`}
        onClick={() => entrada.current?.click()}
      >
        <Paperclip aria-hidden className="size-4" />
        Adjuntar archivos o capturas
      </Boton>
      <input
        ref={entrada}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Adjuntar archivos"
        onChange={(e) => {
          cambiar(agregarArchivos(archivos, Array.from(e.target.files ?? []), maxMb));
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function GaleriaAdjuntos({ adjuntos }: { adjuntos: Adjunto[] }) {
  const [vista, setVista] = useState<Adjunto | null>(null);
  if (!adjuntos.length) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {adjuntos.map((a) => (
          <li key={a.id}>
            {esImagen(a.mime) ? (
              <button
                type="button"
                onClick={() => setVista(a)}
                className="block overflow-hidden rounded-md border border-borde"
                aria-label={`Ver ${a.nombre}`}
              >
                <img src={`/api/adjuntos/${a.id}`} alt={a.nombre} loading="lazy" className="size-24 object-cover" />
              </button>
            ) : (
              <a
                href={`/api/adjuntos/${a.id}${a.mime === 'application/pdf' ? '' : '?descargar=1'}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-borde bg-superficie px-3 py-2 text-sm text-texto hover:bg-superficie-2"
              >
                <FileText aria-hidden className="size-5 shrink-0" />
                <span className="max-w-52 truncate">{a.nombre}</span>
                <span className="text-xs text-suave">{formatearBytes(a.bytes)}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
      {vista && (
        <Dialogo abierto cerrar={() => setVista(null)} titulo={vista.nombre} className="w-[min(96vw,60rem)]">
          <img src={`/api/adjuntos/${vista.id}`} alt={vista.nombre} className="mx-auto max-h-[70dvh] object-contain" />
          <a href={`/api/adjuntos/${vista.id}?descargar=1`} className="mt-3 inline-flex items-center gap-2 text-sm text-enlace underline">
            <Download aria-hidden className="size-4" /> Descargar
          </a>
        </Dialogo>
      )}
    </>
  );
}
