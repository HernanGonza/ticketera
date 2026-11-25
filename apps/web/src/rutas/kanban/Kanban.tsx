import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { COLUMNAS_KANBAN, ETIQUETA_ESTADO, puedeTransicionar, type Estado } from '@eco/shared/dominio';
import { SALAS } from '@eco/shared/realtime';
import type { Persona, TicketResumen } from '@eco/shared/schemas';
import { ErrorVista, estilosBoton } from '../../componentes/ui/basicos';
import { asignar } from '../../lib/acciones';
import { api } from '../../lib/api';
import { claves, qKanban, qNoLeidos } from '../../lib/consultas';
import { useAhora, useCalendario, useCatalogo, useSala, useUsuario } from '../../lib/hooks';
import {
  agrupar,
  calcularVecinos,
  filtrarTickets,
  ordenProvisional,
  parcheDeEstado,
  type Columnas,
  type FiltrosKanban,
  type Vecinos,
} from '../../lib/kanban';
import { mutarTicket } from '../../lib/optimista';
import { BarraAvatares } from './Avatares';
import { Columna } from './Columna';
import { anuncios, colisiones, coordenadasTeclado, instrucciones, type DatosDestino } from './dnd';
import { Filtros } from './Filtros';
import { ContenidoTarjeta, type AccionesTarjeta } from './Tarjeta';

const ruta = getRouteApi('/app/kanban');
const SIN_TECNICOS: Persona[] = [];
const SIN_TICKETS: TicketResumen[] = [];

/** Reutiliza los arreglos de las columnas que no cambiaron para no volver a dibujarlas. */
function useColumnasEstables(nuevas: Columnas): Columnas {
  const previas = useRef<Columnas | null>(null);
  return useMemo(() => {
    const p = previas.current;
    if (p)
      for (const e of COLUMNAS_KANBAN)
        if (p[e].length === nuevas[e].length && p[e].every((t, i) => t === nuevas[e][i])) nuevas[e] = p[e];
    previas.current = nuevas;
    return nuevas;
  }, [nuevas]);
}

export function Kanban() {
  const filtros = ruta.useSearch();
  const navegar = ruta.useNavigate();
  const qc = useQueryClient();
  const usuario = useUsuario();
  const catalogo = useCatalogo();
  const calendario = useCalendario();
  const ahora = useAhora();
  const consulta = useQuery(qKanban);
  const noLeidos = useQuery(qNoLeidos).data?.porTicket;
  const [activoId, setActivo] = useState<string | null>(null);
  const buscador = useRef<HTMLInputElement>(null);
  useSala(SALAS.tecnicos);

  const tickets = consulta.data?.tickets ?? SIN_TICKETS;
  // El filtro de vencidos depende del reloj; los demás no necesitan recalcularse cada minuto.
  const momento = filtros.vencidos ? ahora : null;
  const columnas = useColumnasEstables(
    useMemo(
      () => agrupar(filtrarTickets(tickets, filtros, usuario.id, momento ?? new Date(), calendario)),
      [tickets, filtros, usuario.id, momento, calendario],
    ),
  );
  const tecnicos = catalogo?.tecnicos ?? SIN_TECNICOS;
  const activo = activoId ? tickets.find((t) => t.id === activoId) : undefined;

  const cambiarFiltros = useCallback(
    (c: Partial<FiltrosKanban>) => void navegar({ search: (s) => ({ ...s, ...c }), replace: true }),
    [navegar],
  );

  // Referencia viva para que las acciones sean estables y las tarjetas no se redibujen.
  const vivo = useRef({ tickets, columnas, usuario });
  vivo.current = { tickets, columnas, usuario };

  const { acciones, mover } = useMemo(() => {
    const buscar = (id: string) => vivo.current.tickets.find((t) => t.id === id);
    const mover = (t: TicketResumen, estado: Estado, vecinos: Vecinos) => {
      const { columnas, usuario } = vivo.current;
      const parche = {
        ...parcheDeEstado(t, estado, { id: usuario.id, nombre: usuario.nombre }),
        ordenKanban: ordenProvisional(columnas[estado].filter((x) => x.id !== t.id), vecinos),
      };
      void mutarTicket<TicketResumen>(qc, {
        id: t.id,
        parche,
        enviar: (version) =>
          api(`/api/tickets/${t.id}/mover`, { metodo: 'PATCH', cuerpo: { version, estado, ...vecinos } }),
      }).then((r) => {
        if (r) void qc.invalidateQueries({ queryKey: claves.eventos(t.id) });
      });
    };
    const acciones: AccionesTarjeta = {
      mover: (id, estado) => {
        const t = buscar(id);
        if (t) mover(t, estado, { antesDeId: null, despuesDeId: null });
      },
      desplazar: (id, sentido) => {
        const t = buscar(id);
        if (!t) return;
        const ids = vivo.current.columnas[t.estado].map((x) => x.id);
        const vecino = ids[ids.indexOf(id) + sentido];
        const v = vecino ? calcularVecinos(ids, id, vecino) : null;
        if (v) mover(t, t.estado, v);
      },
      asignar: (id, tecnico) => {
        const t = buscar(id);
        if (t && (t.asignado?.id ?? null) !== (tecnico?.id ?? null)) void asignar(qc, t, tecnico);
      },
    };
    return { acciones, mover };
  }, [qc]);

  const menu = useMemo(() => ({ acciones, tecnicos, rol: usuario.rol }), [acciones, tecnicos, usuario.rol]);

  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: coordenadasTeclado,
      keyboardCodes: { start: ['Space', 'Enter'], end: ['Space', 'Enter'], cancel: ['Escape'] },
    }),
  );
  const accesibilidad = useMemo(
    () => ({
      announcements: anuncios((id) => vivo.current.tickets.find((t) => t.id === id)?.codigo ?? ''),
      screenReaderInstructions: instrucciones,
    }),
    [],
  );

  const puede = useCallback(
    (t: TicketResumen, e: Estado) =>
      t.estado === e ||
      puedeTransicionar(t.estado, e, { rol: usuario.rol, esSolicitante: false, tieneAsignado: !!t.asignado }),
    [usuario.rol],
  );

  const alSoltar = ({ active, over }: DragEndEvent) => {
    setActivo(null);
    const t = vivo.current.tickets.find((x) => x.id === active.id);
    const d = over?.data.current as DatosDestino | undefined;
    if (!t || !over || !d) return;
    if (d.tipo === 'avatar') return acciones.asignar(t.id, d.tecnico);
    if (!puede(t, d.estado)) {
      toast.error(`No se puede pasar de ${ETIQUETA_ESTADO[t.estado]} a ${ETIQUETA_ESTADO[d.estado]}.`);
      return;
    }
    const ids = vivo.current.columnas[d.estado].map((x) => x.id);
    const vecinos = calcularVecinos(ids, t.id, d.tipo === 'tarjeta' ? String(over.id) : null);
    if (vecinos) mover(t, d.estado, vecinos);
  };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const destino = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || destino.closest('input, textarea, select, [contenteditable], [role=dialog], [role=menu]'))
        return;
      if (e.key === '/') {
        e.preventDefault();
        buscador.current?.focus();
      } else if (e.key === 'n') {
        e.preventDefault();
        void navegar({ to: '/nuevo', search: {} });
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [navegar]);

  if (!consulta.data && !consulta.isPending)
    return <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />;

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[32rem] flex-col gap-3 md:h-[calc(100dvh-7rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Tablero Kanban</h1>
        <Link to="/nuevo" className={estilosBoton({ tamano: 'sm' })} aria-keyshortcuts="n">
          <Plus aria-hidden className="size-4" /> Nuevo pedido (n)
        </Link>
      </div>
      <Filtros filtros={filtros} catalogo={catalogo} cambiar={cambiarFiltros} buscador={buscador} />
      <DndContext
        sensors={sensores}
        collisionDetection={colisiones}
        accessibility={accesibilidad}
        measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
        onDragStart={({ active }) => setActivo(String(active.id))}
        onDragEnd={alSoltar}
        onDragCancel={() => setActivo(null)}
      >
        <BarraAvatares tecnicos={tecnicos} arrastrando={!!activoId} />
        {consulta.isPending ? (
          <div role="status" aria-label="Cargando tablero" className="flex min-h-0 flex-1 gap-3 overflow-hidden">
            {COLUMNAS_KANBAN.map((e) => (
              <div key={e} className="esqueleto w-72 shrink-0" />
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
            {COLUMNAS_KANBAN.map((e) => (
              <Columna
                key={e}
                estado={e}
                tickets={columnas[e]}
                valida={activo ? puede(activo, e) : null}
                activoId={activo?.estado === e ? activo.id : null}
                ahora={ahora}
                calendario={calendario}
                noLeidos={noLeidos}
                menu={menu}
              />
            ))}
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {activo && (
            <div className="tarjeta w-72 cursor-grabbing border-primario p-2.5 shadow-alta">
              <ContenidoTarjeta ticket={activo} ahora={ahora} calendario={calendario} noLeidos={noLeidos?.[activo.id] ?? 0} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
