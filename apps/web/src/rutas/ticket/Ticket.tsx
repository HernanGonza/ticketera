import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ArrowLeft, Eye, Paperclip, Star } from 'lucide-react';
import { toast } from 'sonner';
import {
  esStaff,
  estadoAlReabrir,
  formatearFechaHora,
  puedeEscribirTicket,
  puedeTransicionar,
} from '@eco/shared/dominio';
import { SALAS } from '@eco/shared/realtime';
import { NOMBRE_SISTEMA } from '@eco/shared/marca';
import type { TicketDetalle } from '@eco/shared/schemas';
import { agregarArchivos, GaleriaAdjuntos, subirArchivos } from '../../componentes/Adjuntos';
import { BarraSla } from '../../componentes/BarraSla';
import { Avatar, InsigniaEstado, InsigniaPrioridad } from '../../componentes/insignias';
import { Texto } from '../../componentes/Texto';
import { Boton, Campo, ErrorVista, Esqueletos, estilosBoton } from '../../componentes/ui/basicos';
import { Dialogo } from '../../componentes/ui/flotantes';
import { cambiarEstado } from '../../lib/acciones';
import { useAlmacen } from '../../lib/almacen';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { claves, qTicket } from '../../lib/consultas';
import { useAhora, useCalendario, useCatalogo, useSala, useUsuario } from '../../lib/hooks';
import { formatearDato } from '../../lib/historial';
import { escribirTicket, mutarTicket } from '../../lib/optimista';
import { presencia } from '../../lib/vivo';
import { Chat } from './Chat';
import { Gestion } from './Gestion';
import { Historial } from './Historial';

const ruta = getRouteApi('/app/tickets/$id');

export function PaginaTicket() {
  const { id } = ruta.useParams();
  const consulta = useQuery(qTicket(id));
  if (consulta.isPending) return <Esqueletos filas={5} alto="h-24" className="mx-auto max-w-5xl" />;
  if (!consulta.data) return <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />;
  return <Detalle key={consulta.data.id} ticket={consulta.data} />;
}

function Detalle({ ticket: t }: { ticket: TicketDetalle }) {
  const usuario = useUsuario();
  const staff = esStaff(usuario);
  const escribe = puedeEscribirTicket(usuario, { solicitanteId: t.solicitante.id });
  const esDueno = t.solicitante.id === usuario.id;
  const catalogo = useCatalogo();
  const ahora = useAhora();
  const calendario = useCalendario();
  useSala(SALAS.ticket(t.id));
  useEffect(() => {
    document.title = `${t.codigo} · ${NOMBRE_SISTEMA}`;
  }, [t.codigo]);

  const campos = catalogo?.categorias.find((c) => c.id === t.categoriaId)?.campos;
  const datos = Object.entries(t.datos);

  const detalles: [string, string][] = [
    ['Categoría', t.categoriaNombre],
    ...(staff ? ([['Área', t.areaNombre ?? '—']] as [string, string][]) : []),
    ['Ubicación / interno', t.ubicacion ?? '—'],
    ['Atiende', t.asignado?.nombre ?? 'Sin asignar'],
    ...(staff ? ([['Correo', t.solicitanteEmail]] as [string, string][]) : []),
    ['Creado', formatearFechaHora(t.creadoAt)],
    ...(t.resueltoAt ? ([['Resuelto', formatearFechaHora(t.resueltoAt)]] as [string, string][]) : []),
    ...(t.cerradoAt ? ([['Cerrado', formatearFechaHora(t.cerradoAt)]] as [string, string][]) : []),
    ...(t.reabierto ? ([['Reaperturas', String(t.reabierto)]] as [string, string][]) : []),
    ...(staff && t.calificacion !== null && !esDueno
      ? ([['Calificación', `${t.calificacion} de 5${t.comentarioCalificacion ? ` · ${t.comentarioCalificacion}` : ''}`]] as [string, string][])
      : []),
  ];
  const informacion = (
    <dl className="flex flex-col gap-1.5">
      {detalles.map(([k, v]) => (
        <div key={k} className="flex flex-wrap justify-between gap-x-3">
          <dt className="shrink-0 text-suave">{k}</dt>
          <dd className="ml-auto max-w-full text-right wrap-anywhere">{v}</dd>
        </div>
      ))}
    </dl>
  );
  const principal = (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="tarjeta p-4" aria-label="Descripción del pedido">
        <p className="mb-2 flex items-center gap-2 text-sm text-suave">
          <Avatar nombre={t.solicitante.nombre} />
          <span>
            <strong className="text-texto">{t.solicitante.nombre}</strong> · {formatearFechaHora(t.creadoAt)}
          </span>
        </p>
        <Texto texto={t.descripcion} />
        {datos.length > 0 && (
          <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-borde pt-3 text-sm sm:grid-cols-2">
            {datos.map(([k, v]) => {
              const campo = campos?.find((c) => c.clave === k);
              return (
                <div key={k}>
                  <dt className="text-xs text-suave">{campo?.etiqueta ?? k}</dt>
                  <dd className="break-words">{formatearDato(campo, v)}</dd>
                </div>
              );
            })}
          </dl>
        )}
        {!staff && t.adjuntos.length > 0 && (
          <div className="mt-3">
            <GaleriaAdjuntos adjuntos={t.adjuntos} />
          </div>
        )}
      </section>
      <Acciones ticket={t} />
      {esDueno && (t.estado === 'resuelto' || t.estado === 'cerrado' || t.calificacion !== null) && <Calificacion ticket={t} />}
      <Chat ticket={t} usuario={usuario} puedeEscribir={escribe} />
    </div>
  );

  return (
    <div className={cn('mx-auto', staff ? 'max-w-6xl' : 'max-w-3xl')}>
      <Link to={staff ? '/kanban' : '/mis-pedidos'} className="mb-2 inline-flex items-center gap-1 text-sm text-enlace">
        <ArrowLeft aria-hidden className="size-4" /> {staff ? 'Volver al tablero' : 'Volver a mis pedidos'}
      </Link>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <InsigniaEstado estado={t.estado} data-testid="estado-ticket" />
          {staff && <InsigniaPrioridad prioridad={t.prioridad} />}
          <span className="text-sm text-suave">{t.codigo}</span>
          <Presentes ticketId={t.id} yo={usuario.id} />
        </div>
        <h1 className="mt-1 break-words">{t.titulo}</h1>
      </header>
      {staff ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {principal}
          <aside className="flex flex-col gap-4" aria-label="Datos del pedido">
            <Gestion ticket={t} usuario={usuario} />
            <section className="tarjeta p-4 text-sm">
              <BarraSla ticket={t} ahora={ahora} calendario={calendario} />
            </section>
            <Plegable titulo="Información">{informacion}</Plegable>
            <Plegable titulo={`Adjuntos (${t.adjuntos.length})`} abierto={t.adjuntos.length > 0}>
              <Archivos ticket={t} puedeSubir={escribe} maxMb={catalogo?.configuracion.adjuntoMaxMb ?? 10} />
            </Plegable>
            <Historial ticketId={t.id} />
          </aside>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {principal}
          <Plegable titulo="Detalles">{informacion}</Plegable>
        </div>
      )}
    </div>
  );
}

function Plegable({ titulo, abierto, children }: { titulo: string; abierto?: boolean; children: React.ReactNode }) {
  return (
    <details className="tarjeta p-4 text-sm" open={abierto}>
      <summary className="cursor-pointer font-bold">{titulo}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Presentes({ ticketId, yo }: { ticketId: string; yo: string }) {
  const presentes = useAlmacen(presencia, (p) => p[ticketId]);
  const otros = presentes?.filter((u) => u.id !== yo) ?? [];
  if (!otros.length) return null;
  return (
    <span className="ml-auto flex items-center gap-1 text-xs text-suave" data-testid="presencia">
      <Eye aria-hidden className="size-4" />
      <span className="sr-only">También viendo este pedido:</span>
      {otros.map((u) => (
        <Avatar key={u.id} nombre={u.nombre} className="size-6 text-[0.6rem]" />
      ))}
    </span>
  );
}

/** Reabrir, confirmar solución y cancelar, según la máquina de estados. */
function Acciones({ ticket: t }: { ticket: TicketDetalle }) {
  const qc = useQueryClient();
  const usuario = useUsuario();
  const [dialogo, setDialogo] = useState<'reabrir' | 'cancelar' | null>(null);
  const [motivo, setMotivo] = useState('');
  const ctx = {
    rol: usuario.rol,
    esSolicitante: t.solicitante.id === usuario.id,
    tieneAsignado: !!t.asignado,
  };
  const destino = estadoAlReabrir(ctx.tieneAsignado);
  const puedeReabrir = t.estado === 'resuelto' && puedeTransicionar(t.estado, destino, ctx);
  const puedeCancelar = puedeTransicionar(t.estado, 'cancelado', ctx);
  const puedeCerrar = !esStaff(usuario) && puedeTransicionar(t.estado, 'cerrado', ctx);
  if (!puedeReabrir && !puedeCancelar && !puedeCerrar) return null;

  const reabrir = () => {
    setDialogo(null);
    void mutarTicket<TicketDetalle>(qc, {
      id: t.id,
      parche: { estado: destino, resueltoAt: null },
      enviar: (version) =>
        api(`/api/tickets/${t.id}/reabrir`, { metodo: 'POST', cuerpo: { version, motivo: motivo.trim() || undefined } }),
    }).then((r) => {
      if (!r) return;
      setMotivo('');
      toast.success('El pedido se reabrió.');
      void qc.invalidateQueries({ queryKey: claves.mensajes(t.id) });
      void qc.invalidateQueries({ queryKey: claves.eventos(t.id) });
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {puedeReabrir && (
        <Boton variante="secundario" onClick={() => setDialogo('reabrir')}>
          Reabrir
        </Boton>
      )}
      {puedeCerrar && (
        <Boton variante="secundario" onClick={() => void cambiarEstado(qc, t, 'cerrado', usuario)}>
          Confirmar solución y cerrar
        </Boton>
      )}
      {puedeCancelar && (
        <Boton variante="fantasma" className="text-peligro" onClick={() => setDialogo('cancelar')}>
          Cancelar pedido
        </Boton>
      )}
      <Dialogo abierto={dialogo === 'reabrir'} cerrar={() => setDialogo(null)} titulo="Reabrir el pedido">
        <Campo etiqueta="Motivo (opcional)">
          {(p) => <textarea {...p} rows={3} maxLength={2000} className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
        <div className="mt-4 flex justify-end gap-2">
          <Boton variante="secundario" onClick={() => setDialogo(null)}>
            Volver
          </Boton>
          <Boton onClick={reabrir}>Reabrir pedido</Boton>
        </div>
      </Dialogo>
      <Dialogo
        abierto={dialogo === 'cancelar'}
        cerrar={() => setDialogo(null)}
        titulo="Cancelar el pedido"
        descripcion="Esta acción no se puede deshacer."
      >
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={() => setDialogo(null)}>
            Volver
          </Boton>
          <Boton
            variante="peligro"
            onClick={() => {
              setDialogo(null);
              void cambiarEstado(qc, t, 'cancelado', usuario);
            }}
          >
            Sí, cancelar
          </Boton>
        </div>
      </Dialogo>
    </div>
  );
}

const NIVELES = ['Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

function Calificacion({ ticket: t }: { ticket: TicketDetalle }) {
  const qc = useQueryClient();
  const { calificar } = ruta.useSearch();
  const [valor, setValor] = useState(t.calificacion ?? 0);
  const [comentario, setComentario] = useState('');
  const caja = useRef<HTMLFieldSetElement>(null);
  const enviar = useMutation({
    mutationFn: () =>
      api<TicketDetalle>(`/api/tickets/${t.id}/calificar`, {
        metodo: 'POST',
        cuerpo: { calificacion: valor, comentario: comentario.trim() || undefined },
      }),
    onSuccess: (r) => {
      escribirTicket(qc, r);
      void qc.invalidateQueries({ queryKey: claves.detalles });
      toast.success('Gracias por su calificación.');
    },
  });
  const pendiente = t.calificacion === null;

  useEffect(() => {
    if (!calificar || !pendiente) return;
    caja.current?.scrollIntoView({ block: 'center' });
    caja.current?.querySelector('input')?.focus();
  }, [calificar, pendiente]);

  if (!pendiente)
    return (
      <section className="tarjeta p-4 text-sm">
        <h2>Su calificación</h2>
        <p className="flex items-center gap-1" aria-label={`${t.calificacion} de 5`} role="img">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} aria-hidden className={`size-5 text-acento ${n <= (t.calificacion ?? 0) ? 'fill-current' : ''}`} />
          ))}
        </p>
        {t.comentarioCalificacion && <p className="mt-1 text-suave">{t.comentarioCalificacion}</p>}
      </section>
    );
  return (
    <section className="tarjeta border-primario p-4">
      <fieldset ref={caja}>
        <legend className="mb-1 font-bold">¿Cómo fue la atención?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer rounded-md p-1 has-focus-visible:outline-2 has-focus-visible:outline-foco">
              <input type="radio" name="calificacion" value={n} className="sr-only" checked={valor === n} onChange={() => setValor(n)} />
              <Star aria-hidden className={`size-8 text-acento ${n <= valor ? 'fill-current' : ''}`} />
              <span className="sr-only">
                {n} de 5: {NIVELES[n - 1]}
              </span>
            </label>
          ))}
        </div>
        <p className="mb-2 h-5 text-sm text-suave">{valor ? NIVELES[valor - 1] : ''}</p>
      </fieldset>
      <Campo etiqueta="Comentario (opcional)">
        {(p) => <textarea {...p} rows={2} maxLength={1000} className="entrada" value={comentario} onChange={(e) => setComentario(e.target.value)} />}
      </Campo>
      <Boton className="mt-3" disabled={!valor} ocupado={enviar.isPending} onClick={() => enviar.mutate()}>
        Enviar calificación
      </Boton>
    </section>
  );
}

function Archivos({ ticket: t, puedeSubir, maxMb }: { ticket: TicketDetalle; puedeSubir: boolean; maxMb: number }) {
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const subir = useMutation({
    mutationFn: (archivos: File[]) =>
      subirArchivos(`/api/tickets/${t.id}/adjuntos`, archivos, () => void qc.invalidateQueries({ queryKey: claves.detalles })),
  });
  return (
    <>
      {t.adjuntos.length ? <GaleriaAdjuntos adjuntos={t.adjuntos} /> : <p className="text-suave">Sin archivos.</p>}
      {puedeSubir && (
        <>
          <button type="button" className={`${estilosBoton({ variante: 'secundario', tamano: 'sm' })} mt-3`} onClick={() => entrada.current?.click()} disabled={subir.isPending}>
            <Paperclip aria-hidden className="size-4" /> {subir.isPending ? 'Subiendo…' : 'Agregar archivo'}
          </button>
          <input
            ref={entrada}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Agregar archivo al pedido"
            onChange={(e) => {
              const a = agregarArchivos([], Array.from(e.target.files ?? []), maxMb);
              if (a.length) subir.mutate(a);
              e.target.value = '';
            }}
          />
        </>
      )}
    </>
  );
}
