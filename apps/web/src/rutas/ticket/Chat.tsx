import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Paperclip, Send, Zap } from 'lucide-react';
import { esStaff, formatearFechaHora } from '@eco/shared/dominio';
import type { Adjunto, Mensaje, TicketDetalle, TicketEvento, UsuarioActual } from '@eco/shared/schemas';
import { agregarArchivos, GaleriaAdjuntos, ListaArchivos } from '../../componentes/Adjuntos';
import { Avatar } from '../../componentes/insignias';
import { Texto } from '../../componentes/Texto';
import { Boton, Esqueletos, ErrorVista } from '../../componentes/ui/basicos';
import { ItemMenu, Menu, SeparadorMenu } from '../../componentes/ui/flotantes';
import { useAlmacen } from '../../lib/almacen';
import { api } from '../../lib/api';
import { archivosPegados } from '../../lib/adjuntos';
import { enviosPendientes, insertarMensaje, type DatosMensajes, type MensajeLocal } from '../../lib/cache';
import { avisarError, claves, qEventos, qMensajes } from '../../lib/consultas';
import { cn } from '../../lib/cn';
import { CanalEscritura } from '../../lib/escritura';
import { useCatalogo } from '../../lib/hooks';
import { describirEvento } from '../../lib/historial';
import { canal, escribiendo } from '../../lib/vivo';
import { RespuestasRapidas } from './Respuestas';

interface Envio {
  clienteId: string;
  cuerpo: string;
  interno: boolean;
  archivos: File[];
}

const nuevoId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Envíos fallidos: se conservan aunque se cambie de pantalla, para poder reintentarlos. */
const fallidos = new Map<string, Envio>();

function useEnvio(ticketId: string, usuario: UsuarioActual) {
  const qc = useQueryClient();
  const clave = claves.mensajes(ticketId);
  const poner = (m: MensajeLocal) =>
    qc.setQueryData<DatosMensajes>(clave, (d) => (d ? { ...d, items: insertarMensaje(d.items, m) } : { items: [m] }));
  const quitar = (clienteId: string) => {
    enviosPendientes.delete(clienteId);
    fallidos.delete(clienteId);
    qc.setQueryData<DatosMensajes>(clave, (d) =>
      d ? { ...d, items: d.items.filter((m) => !(m.envio && m.clienteId === clienteId)) } : d,
    );
  };
  const marcar = (clienteId: string, envio: 'enviando' | 'error') =>
    qc.setQueryData<DatosMensajes>(clave, (d) =>
      d ? { ...d, items: d.items.map((m) => (m.envio && m.clienteId === clienteId ? { ...m, envio } : m)) } : d,
    );

  const mutacion = useMutation({
    mutationFn: ({ clienteId, cuerpo, interno }: Envio) =>
      api<Mensaje>(`/api/tickets/${ticketId}/mensajes`, { metodo: 'POST', cuerpo: { cuerpo, interno, clienteId } }),
    onMutate: (e) => {
      enviosPendientes.add(e.clienteId);
      void qc.cancelQueries({ queryKey: clave });
      poner({
        id: `tmp-${e.clienteId}`,
        ticketId,
        autor: { id: usuario.id, nombre: usuario.nombre, esStaff: esStaff(usuario) },
        cuerpo: e.cuerpo,
        interno: e.interno,
        clienteId: e.clienteId,
        creadoAt: new Date().toISOString(),
        editadoAt: null,
        adjuntos: [],
        envio: 'enviando',
      });
      marcar(e.clienteId, 'enviando');
    },
    onSuccess: async (m, e) => {
      enviosPendientes.delete(e.clienteId);
      fallidos.delete(e.clienteId);
      poner({ ...m, clienteId: m.clienteId ?? e.clienteId });
      if (!e.archivos.length) return;
      for (const f of e.archivos) {
        const d = new FormData();
        d.append('archivo', f);
        try {
          await api<Adjunto>(`/api/tickets/${ticketId}/adjuntos?mensajeId=${m.id}`, { metodo: 'POST', cuerpo: d });
        } catch (error) {
          avisarError(error);
        }
      }
      void qc.invalidateQueries({ queryKey: clave });
      void qc.invalidateQueries({ queryKey: claves.detalles });
    },
    onError: (_e, envio) => {
      fallidos.set(envio.clienteId, envio);
      marcar(envio.clienteId, 'error');
    },
  });

  return {
    enviar: mutacion.mutate,
    reintentar: (clienteId: string) => {
      const e = fallidos.get(clienteId);
      if (e) mutacion.mutate(e);
    },
    descartar: quitar,
  };
}

/** Marca como leído el último mensaje confirmado mientras la pestaña está visible. */
function useLectura(ticketId: string, items: MensajeLocal[] | undefined) {
  const qc = useQueryClient();
  const ultimo = items?.filter((m) => !m.envio).at(-1)?.id;
  useEffect(() => {
    if (!ultimo) return;
    let hecho = false;
    const leer = () => {
      if (hecho || document.visibilityState !== 'visible') return;
      hecho = true;
      void api(`/api/tickets/${ticketId}/lectura`, { metodo: 'POST', cuerpo: { ultimoMensajeId: ultimo } })
        .then(() => qc.invalidateQueries({ queryKey: claves.noLeidos }))
        .catch(() => {
          hecho = false;
        });
    };
    leer();
    document.addEventListener('visibilitychange', leer);
    return () => document.removeEventListener('visibilitychange', leer);
  }, [ticketId, ultimo, qc]);
}

type Entrada = { fecha: number } & ({ m: MensajeLocal } | { e: TicketEvento });

export function Chat({ ticket, usuario, puedeEscribir }: { ticket: TicketDetalle; usuario: UsuarioActual; puedeEscribir: boolean }) {
  const consulta = useQuery(qMensajes(ticket.id));
  const eventos = useQuery(qEventos(ticket.id)).data?.items;
  const items = consulta.data?.items;
  useLectura(ticket.id, items);
  const envio = useEnvio(ticket.id, usuario);
  const acciones = useRef(envio);
  acciones.current = envio;

  const linea = useMemo<Entrada[]>(
    () =>
      [
        ...(items ?? []).map((m) => ({ m, fecha: Date.parse(m.creadoAt) })),
        ...(eventos ?? []).filter((e) => e.tipo !== 'creado').map((e) => ({ e, fecha: Date.parse(e.fecha) })),
      ].sort((a, b) => a.fecha - b.fecha),
    [items, eventos],
  );

  const caja = useRef<HTMLDivElement>(null);
  const abajo = useRef(true);
  const cantidad = linea.length;
  useLayoutEffect(() => {
    const c = caja.current;
    if (c && abajo.current) c.scrollTop = c.scrollHeight;
  }, [cantidad]);

  return (
    <section className="tarjeta flex flex-col" aria-label="Conversación">
      <h2 className="border-b border-borde px-4 py-3">Conversación</h2>
      <div
        ref={caja}
        onScroll={(e) => {
          const c = e.currentTarget;
          abajo.current = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
        }}
        className="max-h-[65dvh] overflow-y-auto p-3"
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensajes y movimientos"
      >
        {consulta.isPending ? (
          <Esqueletos filas={3} />
        ) : !consulta.data ? (
          <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />
        ) : !linea.length ? (
          <p className="py-8 text-center text-sm text-suave">Todavía no hay mensajes en este pedido.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {linea.map((x) =>
              'm' in x ? (
                <Burbuja key={x.m.clienteId ?? x.m.id} m={x.m} propio={x.m.autor.id === usuario.id} acciones={acciones} />
              ) : (
                <li key={`e-${x.e.id}`} className="text-center text-xs text-suave">
                  {describirEvento(x.e)} · <time dateTime={x.e.fecha}>{formatearFechaHora(x.e.fecha)}</time>
                </li>
              ),
            )}
          </ol>
        )}
      </div>
      <Indicador ticketId={ticket.id} />
      {puedeEscribir ? (
        <Redactor
          ticketId={ticket.id}
          staff={esStaff(usuario)}
          enviar={(e) => {
            abajo.current = true;
            envio.enviar(e);
          }}
        />
      ) : (
        <p className="border-t border-borde p-4 text-sm text-suave">
          Usted puede consultar este pedido, pero solo quien lo creó y el equipo de Soporte pueden escribir en él.
        </p>
      )}
    </section>
  );
}

function Indicador({ ticketId }: { ticketId: string }) {
  const lista = useAlmacen(escribiendo, (e) => e[ticketId]);
  const nombres = lista?.map((x) => x.usuario.nombre) ?? [];
  return (
    <div aria-live="polite" className="h-6 px-4 text-xs text-suave italic">
      {nombres.length > 0 && (
        <span data-testid="escribiendo">
          {nombres.join(', ')} {nombres.length > 1 ? 'están' : 'está'} escribiendo
          {lista?.every((x) => x.interno) ? ' una nota interna' : ''}…
        </span>
      )}
    </div>
  );
}

interface AccionesBurbuja {
  reintentar: (id: string) => void;
  descartar: (id: string) => void;
}

const Burbuja = memo(function Burbuja({ m, propio, acciones }: { m: MensajeLocal; propio: boolean; acciones: { current: AccionesBurbuja } }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<string | null>(null);
  const editar = useMutation({
    mutationFn: (cuerpo: string) => api<Mensaje>(`/api/mensajes/${m.id}`, { metodo: 'PATCH', cuerpo: { cuerpo } }),
    onMutate: (cuerpo) => {
      const clave = claves.mensajes(m.ticketId);
      qc.setQueryData<DatosMensajes>(clave, (d) =>
        d ? { ...d, items: d.items.map((x) => (x.id === m.id ? { ...x, cuerpo } : x)) } : d,
      );
      setEditando(null);
    },
    onSuccess: (r) =>
      qc.setQueryData<DatosMensajes>(claves.mensajes(m.ticketId), (d) =>
        d ? { ...d, items: insertarMensaje(d.items, r) } : d,
      ),
    onError: (_e, cuerpo) => {
      setEditando(cuerpo);
      void qc.invalidateQueries({ queryKey: claves.mensajes(m.ticketId) });
    },
  });
  return (
    <li data-testid="mensaje" data-interno={m.interno} className={cn('flex gap-2', propio && 'flex-row-reverse')}>
      <Avatar nombre={m.autor.nombre} />
      <div
        className={cn(
          'max-w-[85%] min-w-0 rounded-lg border p-2.5 text-sm',
          m.interno
            ? 'border-dashed border-nota-borde bg-nota-fondo text-nota-texto'
            : propio
              ? 'border-transparent bg-primario-suave text-primario-sobre-suave'
              : 'border-borde bg-superficie-2',
          m.envio && 'opacity-75',
        )}
      >
        <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs">
          <strong>{m.autor.nombre}</strong>
          {m.autor.esStaff && <span>Soporte</span>}
          {m.interno && (
            <span className="inline-flex items-center gap-1 font-bold">
              <Lock aria-hidden className="size-3" /> Nota interna
            </span>
          )}
          <time dateTime={m.creadoAt}>{formatearFechaHora(m.creadoAt)}</time>
          {m.editadoAt && <span title={formatearFechaHora(m.editadoAt)}>(editado)</span>}
        </p>
        {editando !== null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editando.trim()) editar.mutate(editando.trim());
            }}
            className="flex w-[min(60vw,28rem)] max-w-full flex-col gap-2"
          >
            <textarea aria-label="Editar mensaje" className="entrada" rows={3} value={editando} autoFocus onChange={(e) => setEditando(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Boton variante="secundario" tamano="sm" onClick={() => setEditando(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm">
                Guardar
              </Boton>
            </div>
          </form>
        ) : (
          <Texto texto={m.cuerpo} />
        )}
        {m.adjuntos.length > 0 && (
          <div className="mt-2">
            <GaleriaAdjuntos adjuntos={m.adjuntos} />
          </div>
        )}
        {m.envio === 'enviando' && <p className="mt-1 text-xs italic">Enviando…</p>}
        {m.envio === 'error' && m.clienteId && (
          <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
            No se envió.
            <button type="button" className="underline" onClick={() => acciones.current.reintentar(m.clienteId!)}>
              Reintentar
            </button>
            <button type="button" className="underline" onClick={() => acciones.current.descartar(m.clienteId!)}>
              Descartar
            </button>
          </p>
        )}
        {propio && !m.envio && editando === null && (
          <button type="button" className="mt-1 text-xs underline" onClick={() => setEditando(m.cuerpo)}>
            Editar
          </button>
        )}
      </div>
    </li>
  );
});

function Redactor({ ticketId, staff, enviar }: { ticketId: string; staff: boolean; enviar: (e: Envio) => void }) {
  const catalogo = useCatalogo();
  const maxMb = catalogo?.configuracion.adjuntoMaxMb ?? 10;
  const [texto, setTexto] = useState('');
  const [interno, setInterno] = useState(false);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [administrar, setAdministrar] = useState(false);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const selector = useRef<HTMLInputElement>(null);
  const internoRef = useRef(interno);
  internoRef.current = interno;
  const escritura = useMemo(
    () => new CanalEscritura((on) => canal.escribiendo?.(ticketId, on, internoRef.current)),
    [ticketId],
  );
  useEffect(() => () => escritura.detener(), [escritura]);

  const mandar = (e?: FormEvent) => {
    e?.preventDefault();
    const cuerpo = texto.trim() || (archivos.length ? `Adjunto: ${archivos.map((a) => a.name).join(', ')}` : '');
    if (!cuerpo) return;
    escritura.detener();
    enviar({ clienteId: nuevoId(), cuerpo, interno, archivos });
    setTexto('');
    setArchivos([]);
    entrada.current?.focus();
  };

  return (
    <form
      onSubmit={mandar}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setArchivos((a) => agregarArchivos(a, Array.from(e.dataTransfer.files), maxMb));
      }}
      className={cn('flex flex-col gap-2 rounded-b-lg border-t border-borde p-3', interno && 'bg-nota-fondo text-nota-texto')}
    >
      {staff && (
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Visibilidad del mensaje</legend>
          {[false, true].map((v) => (
            <label key={String(v)} className="flex items-center gap-1.5 font-semibold">
              <input
                type="radio"
                name="visibilidad"
                className="accent-primario"
                checked={interno === v}
                onChange={() => {
                  escritura.detener();
                  setInterno(v);
                }}
                data-testid={v ? 'chat-interno' : 'chat-publico'}
              />
              {v ? 'Nota interna' : 'Respuesta pública'}
            </label>
          ))}
        </fieldset>
      )}
      <textarea
        ref={entrada}
        data-testid="chat-entrada"
        aria-label={interno ? 'Escriba una nota interna' : 'Escriba un mensaje'}
        placeholder={interno ? 'Nota visible solo para el equipo de Soporte…' : 'Escriba un mensaje…'}
        className="entrada"
        rows={3}
        maxLength={10_000}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          if (e.target.value) escritura.teclear();
          else escritura.detener();
        }}
        onBlur={() => escritura.detener()}
        onPaste={(e) => {
          const f = archivosPegados(e.clipboardData);
          if (!f.length) return;
          e.preventDefault();
          setArchivos((a) => agregarArchivos(a, f, maxMb));
        }}
        onKeyDown={(e) => {
          // En pantallas táctiles Enter agrega una línea.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) mandar(e);
        }}
      />
      <ListaArchivos archivos={archivos} quitar={(i) => setArchivos((a) => a.filter((_, j) => j !== i))} />
      <div className="flex flex-wrap items-center gap-2">
        <Boton variante="secundario" tamano="sm" onClick={() => selector.current?.click()}>
          <Paperclip aria-hidden className="size-4" /> Adjuntar
        </Boton>
        <input
          ref={selector}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Adjuntar archivos al mensaje"
          onChange={(e) => {
            setArchivos((a) => agregarArchivos(a, Array.from(e.target.files ?? []), maxMb));
            e.target.value = '';
          }}
        />
        {staff && (
          <Menu
            alinear="start"
            disparador={
              <Boton variante="secundario" tamano="sm">
                <Zap aria-hidden className="size-4" /> Respuestas rápidas
              </Boton>
            }
          >
            {catalogo?.respuestasRapidas.map((r) => (
              <ItemMenu
                key={r.id}
                alElegir={() => {
                  setTexto((t) => (t ? `${t}\n${r.cuerpo}` : r.cuerpo));
                  setTimeout(() => entrada.current?.focus(), 50);
                }}
              >
                {r.titulo}
              </ItemMenu>
            ))}
            <SeparadorMenu />
            <ItemMenu alElegir={() => setAdministrar(true)}>Administrar respuestas…</ItemMenu>
          </Menu>
        )}
        <span className="text-xs max-md:hidden">Enter envía · Mayús+Enter agrega una línea · admite Markdown</span>
        <Boton type="submit" className="ml-auto" data-testid="chat-enviar" disabled={!texto.trim() && !archivos.length}>
          <Send aria-hidden className="size-4" /> {interno ? 'Guardar nota' : 'Enviar'}
        </Boton>
      </div>
      {administrar && <RespuestasRapidas cerrar={() => setAdministrar(false)} />}
    </form>
  );
}
