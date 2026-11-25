import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  ESTADOS,
  ETIQUETA_ESTADO,
  ETIQUETA_PRIORIDAD,
  PRIORIDADES,
  formatearFechaHora,
  type Estado,
  type Prioridad,
} from '@eco/shared/dominio';
import type { FiltroTickets, TicketResumen } from '@eco/shared/schemas';
import { BarraSla } from '../../componentes/BarraSla';
import { Contador, InsigniaEstado, InsigniaPrioridad } from '../../componentes/insignias';
import { Boton, Encabezado, ErrorVista, Esqueletos, EstadoVacio, estilosBoton, Paginador } from '../../componentes/ui/basicos';
import { CasillaMenu, Menu, TituloMenu, SeparadorMenu, ItemMenu } from '../../componentes/ui/flotantes';
import { guardado } from '../../lib/almacen';
import { api, aQuery } from '../../lib/api';
import type { BusquedaLista, ORDENES_LISTA } from '../../lib/busqueda';
import { claves, qLista, qNoLeidos } from '../../lib/consultas';
import { cn } from '../../lib/cn';
import { useAhora, useCalendario, useCatalogo, useDiferido, useSala } from '../../lib/hooks';
import { SALAS } from '@eco/shared/realtime';

const ruta = getRouteApi('/app/lista');
const VACIO: TicketResumen[] = [];
type Orden = (typeof ORDENES_LISTA)[number];

const TITULOS: Record<string, string> = {
  codigo: 'Código',
  titulo: 'Título',
  estado: 'Estado',
  prioridad: 'Prioridad',
  categoria: 'Categoría',
  area: 'Área',
  solicitante: 'Solicitante',
  asignado: 'Asignado',
  creadoAt: 'Creado',
  actualizadoAt: 'Actualizado',
  venceResolucionAt: 'Plazo',
};
const ORDENABLES: Record<string, Orden> = {
  codigo: 'codigo',
  titulo: 'titulo',
  estado: 'estado',
  prioridad: 'prioridad',
  creadoAt: 'creadoAt',
  actualizadoAt: 'actualizadoAt',
  venceResolucionAt: 'venceResolucionAt',
};
const OCULTAS_POR_DEFECTO: VisibilityState = { solicitante: false, creadoAt: false };

function filtroDe(s: BusquedaLista): FiltroTickets {
  return {
    ...s,
    ambito: s.ambito ?? 'todos',
    orden: s.orden ?? 'actualizadoAt',
    dir: s.dir ?? 'desc',
    pagina: s.pagina ?? 1,
    porPagina: s.porPagina ?? 25,
  };
}

export function Lista() {
  const busqueda = ruta.useSearch();
  const navegar = ruta.useNavigate();
  const filtro = filtroDe(busqueda);
  const consulta = useQuery({ ...qLista(filtro), placeholderData: keepPreviousData });
  const noLeidos = useQuery(qNoLeidos).data?.porTicket;
  const ahora = useAhora();
  const calendario = useCalendario();
  const catalogo = useCatalogo();
  const [seleccion, setSeleccion] = useState<RowSelectionState>({});
  const [visibles, setVisibles] = useState<VisibilityState>(() => guardado.leer('columnas', OCULTAS_POR_DEFECTO));
  useSala(SALAS.tecnicos);
  useEffect(() => guardado.escribir('columnas', visibles), [visibles]);

  const cambiar = useCallback(
    (c: Partial<BusquedaLista>) => {
      setSeleccion({});
      void navegar({ search: (s) => ({ ...s, pagina: undefined, ...c }), replace: true });
    },
    [navegar],
  );

  const columnas = useMemo<ColumnDef<TicketResumen>[]>(() => {
    const col = (id: string, celda: (t: TicketResumen) => React.ReactNode): ColumnDef<TicketResumen> => ({
      id,
      cell: ({ row }) => celda(row.original),
    });
    return [
      col('codigo', (t) => (
        <span className="flex items-center gap-1 whitespace-nowrap">
          <Link to="/tickets/$id" params={{ id: t.codigo }} className="font-bold text-enlace underline">
            {t.codigo}
          </Link>
          <Contador n={noLeidos?.[t.id] ?? 0} etiqueta="mensajes sin leer" />
        </span>
      )),
      col('titulo', (t) => <span className="line-clamp-3 min-w-36">{t.titulo}</span>),
      col('estado', (t) => <InsigniaEstado estado={t.estado} />),
      col('prioridad', (t) => <InsigniaPrioridad prioridad={t.prioridad} />),
      col('categoria', (t) => t.categoriaNombre),
      col('area', (t) => t.areaNombre ?? '—'),
      col('solicitante', (t) => t.solicitante.nombre),
      col('asignado', (t) => t.asignado?.nombre ?? <span className="text-suave">Sin asignar</span>),
      col('creadoAt', (t) => formatearFechaHora(t.creadoAt)),
      col('actualizadoAt', (t) => formatearFechaHora(t.actualizadoAt)),
      col('venceResolucionAt', (t) => (
        <div className="min-w-32">
          <BarraSla ticket={t} ahora={ahora} calendario={calendario} />
        </div>
      )),
    ];
  }, [noLeidos, ahora, calendario]);

  const tabla = useReactTable({
    data: consulta.data?.items ?? VACIO,
    columns: columnas,
    getRowId: (t) => t.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    state: { rowSelection: seleccion, columnVisibility: visibles },
    onRowSelectionChange: setSeleccion,
    onColumnVisibilityChange: setVisibles,
  });
  const ids = Object.keys(seleccion).filter((k) => seleccion[k]);

  const csv = `/api/tickets/exportar.csv${aQuery({ ...filtro, pagina: undefined, porPagina: undefined })}`;

  return (
    <div>
      <Encabezado
        titulo="Lista de tickets"
        acciones={
          <>
            <Menu
              disparador={
                <Boton variante="secundario" tamano="sm">
                  <Columns3 aria-hidden className="size-4" /> Columnas
                </Boton>
              }
            >
              <TituloMenu>Columnas visibles</TituloMenu>
              {tabla.getAllLeafColumns().map((c) => (
                <CasillaMenu key={c.id} marcada={c.getIsVisible()} cambiar={(v) => c.toggleVisibility(v)}>
                  {TITULOS[c.id]}
                </CasillaMenu>
              ))}
              <SeparadorMenu />
              <ItemMenu alElegir={() => setVisibles(OCULTAS_POR_DEFECTO)}>Restablecer</ItemMenu>
            </Menu>
            <a href={csv} download className={estilosBoton({ variante: 'secundario', tamano: 'sm' })} data-testid="exportar-csv">
              <Download aria-hidden className="size-4" /> Exportar CSV
            </a>
          </>
        }
      />
      <FiltrosLista busqueda={busqueda} cambiar={cambiar} />
      {ids.length > 0 && <Masivas ids={ids} items={consulta.data?.items ?? VACIO} tecnicos={catalogo?.tecnicos ?? []} limpiar={setSeleccion} />}
      {consulta.isPending ? (
        <Esqueletos filas={8} alto="h-11" />
      ) : !consulta.data ? (
        <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />
      ) : !consulta.data.items.length ? (
        <EstadoVacio titulo="No hay tickets con estos filtros">Pruebe quitar algún filtro.</EstadoVacio>
      ) : (
        <>
          <div className={cn('tarjeta overflow-x-auto', consulta.isPlaceholderData && 'opacity-60')} tabIndex={0} role="region" aria-label="Tabla de tickets">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-2 text-left">
                  <th scope="col" className="w-9 px-1.5 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primario"
                      aria-label="Seleccionar todos los de la página"
                      checked={tabla.getIsAllRowsSelected()}
                      ref={(n) => {
                        if (n) n.indeterminate = tabla.getIsSomeRowsSelected();
                      }}
                      onChange={tabla.getToggleAllRowsSelectedHandler()}
                    />
                  </th>
                  {tabla.getVisibleLeafColumns().map((c) => {
                    const orden = ORDENABLES[c.id];
                    const activo = orden === filtro.orden;
                    const I = !activo ? ArrowUpDown : filtro.dir === 'asc' ? ArrowUp : ArrowDown;
                    return (
                      <th key={c.id} scope="col" className="px-1.5 py-2 font-semibold whitespace-nowrap" aria-sort={activo ? (filtro.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        {orden ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-semibold"
                            onClick={() => cambiar({ orden, dir: activo && filtro.dir === 'asc' ? 'desc' : 'asc' })}
                          >
                            {TITULOS[c.id]}
                            <I aria-hidden className={cn('size-3.5', !activo && 'opacity-40')} />
                          </button>
                        ) : (
                          TITULOS[c.id]
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tabla.getRowModel().rows.map((f) => (
                  <tr
                    key={f.id}
                    data-testid={`fila-${f.original.codigo}`}
                    className={cn('border-b border-borde last:border-0', f.getIsSelected() && 'bg-primario-suave text-primario-sobre-suave')}
                  >
                    <td className="px-1.5 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-primario"
                        aria-label={`Seleccionar ${f.original.codigo}`}
                        checked={f.getIsSelected()}
                        onChange={f.getToggleSelectedHandler()}
                      />
                    </td>
                    {f.getVisibleCells().map((c) => (
                      <td key={c.id} className="px-1.5 py-2 align-middle">
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              Filas por página
              <select className="entrada !w-auto" value={filtro.porPagina as number} onChange={(e) => cambiar({ porPagina: Number(e.target.value) })}>
                {[25, 50, 100, 200].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex-1">
              <Paginador pagina={filtro.pagina as number} porPagina={filtro.porPagina as number} total={consulta.data.total} cambiar={(pagina) => cambiar({ pagina })} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FiltrosLista({ busqueda: s, cambiar }: { busqueda: BusquedaLista; cambiar: (c: Partial<BusquedaLista>) => void }) {
  const catalogo = useCatalogo();
  const [q, setQ] = useState(s.q ?? '');
  const diferido = useDiferido(q, 300);
  const enviado = useRef(s.q ?? '');
  useEffect(() => {
    if (diferido === enviado.current) return;
    enviado.current = diferido;
    cambiar({ q: diferido || undefined });
  }, [diferido, cambiar]);

  const multiple = <T extends string>(titulo: string, opciones: readonly T[], etiquetas: Record<T, string>, actual: T[] | undefined, fijar: (v: T[] | undefined) => void) => (
    <Menu
      alinear="start"
      disparador={
        <Boton variante="secundario">
          {titulo}
          {actual?.length ? ` (${actual.length})` : ''}
        </Boton>
      }
    >
      {opciones.map((o) => (
        <CasillaMenu
          key={o}
          marcada={!!actual?.includes(o)}
          cambiar={(v) => {
            const r = v ? [...(actual ?? []), o] : (actual ?? []).filter((x) => x !== o);
            fijar(r.length ? r : undefined);
          }}
        >
          {etiquetas[o]}
        </CasillaMenu>
      ))}
    </Menu>
  );
  const selector = (etiqueta: string, valor: string | number | undefined, fijar: (v: string) => void, opciones: [string | number, string][]) => (
    <select aria-label={etiqueta} className="entrada !w-auto max-w-52" value={valor ?? ''} onChange={(e) => fijar(e.target.value)}>
      {opciones.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );

  const aplicados = [s.prioridad, s.areaId, s.categoriaId, s.asignadoId, s.sinAsignar, s.vencidos].filter(
    (v) => v !== undefined,
  ).length;
  const [abierto, setAbierto] = useState(aplicados > 0);

  return (
    <div role="search" className="mb-3 flex flex-wrap items-center gap-2">
      <input type="search" aria-label="Buscar" placeholder="Buscar…" className="entrada !w-full sm:!w-56" value={q} onChange={(e) => setQ(e.target.value)} />
      {selector('Ámbito', s.ambito ?? 'todos', (v) => cambiar({ ambito: v === 'todos' ? undefined : (v as 'mios' | 'area') }), [
        ['todos', 'Todos los tickets'],
        ['mios', 'Mis tickets'],
        ['area', 'De mi área'],
      ])}
      {multiple<Estado>('Estado', ESTADOS, ETIQUETA_ESTADO, s.estado, (estado) => cambiar({ estado }))}
      <Boton variante="secundario" aria-expanded={abierto} aria-controls="filtros-lista" onClick={() => setAbierto(!abierto)}>
        <SlidersHorizontal aria-hidden className="size-4" /> Filtros{aplicados ? ` (${aplicados})` : ''}
      </Boton>
      <div id="filtros-lista" hidden={!abierto} className={cn('w-full flex-wrap items-center gap-2', abierto && 'flex')}>
      {multiple<Prioridad>('Prioridad', PRIORIDADES, ETIQUETA_PRIORIDAD, s.prioridad, (prioridad) => cambiar({ prioridad }))}
      {selector('Área', s.areaId, (v) => cambiar({ areaId: Number(v) || undefined }), [['', 'Todas las áreas'], ...(catalogo?.areas.map((a) => [a.id, a.nombre] as [number, string]) ?? [])])}
      {selector('Categoría', s.categoriaId, (v) => cambiar({ categoriaId: Number(v) || undefined }), [['', 'Todas las categorías'], ...(catalogo?.categorias.map((c) => [c.id, c.nombre] as [number, string]) ?? [])])}
      {selector('Asignado', s.sinAsignar ? 'ninguno' : s.asignadoId, (v) => cambiar({ sinAsignar: v === 'ninguno' || undefined, asignadoId: v && v !== 'ninguno' ? v : undefined }), [
        ['', 'Cualquier asignado'],
        ['ninguno', 'Sin asignar'],
        ...(catalogo?.tecnicos.map((t) => [t.id, t.nombre] as [string, string]) ?? []),
      ])}
      <label className="flex items-center gap-1.5 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-primario" checked={!!s.vencidos} onChange={(e) => cambiar({ vencidos: e.target.checked || undefined })} />
        Vencidos
      </label>
      </div>
    </div>
  );
}

interface ResultadoMasivo {
  actualizados: string[];
  errores: { id: string; mensaje: string }[];
}

function Masivas({
  ids,
  items,
  tecnicos,
  limpiar,
}: {
  ids: string[];
  items: TicketResumen[];
  tecnicos: { id: string; nombre: string }[];
  limpiar: (s: RowSelectionState) => void;
}) {
  const qc = useQueryClient();
  const [errores, setErrores] = useState<string[]>([]);
  const aplicar = useMutation({
    mutationFn: (cambios: { estado?: Estado; prioridad?: Prioridad; asignadoId?: string | null }) =>
      api<ResultadoMasivo>('/api/tickets/masivo', { metodo: 'POST', cuerpo: { ids, cambios } }),
    onSuccess: (r) => {
      if (r.actualizados.length) toast.success(`${r.actualizados.length} ticket(s) actualizados.`);
      const lista = r.errores.map((e) => `${items.find((t) => t.id === e.id)?.codigo ?? e.id}: ${e.mensaje}`);
      setErrores(lista);
      if (lista.length) toast.error(`${lista.length} ticket(s) no se pudieron actualizar.`);
      // Quedan seleccionados solo los que fallaron.
      limpiar(Object.fromEntries(r.errores.map((e) => [e.id, true])));
      void qc.invalidateQueries({ queryKey: claves.tickets });
      void qc.invalidateQueries({ queryKey: claves.detalles });
    },
  });
  const selector = (texto: string, opciones: [string, string][], elegir: (v: string) => void) => (
    <select
      aria-label={texto}
      className="entrada !w-auto"
      value=""
      disabled={aplicar.isPending}
      onChange={(e) => {
        const v = e.target.value;
        if (v && window.confirm(`¿Aplicar el cambio a ${ids.length} ticket(s)?`)) elegir(v);
      }}
    >
      <option value="">{texto}…</option>
      {opciones.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
  return (
    <section aria-label="Acciones masivas" data-testid="acciones-masivas" className="mb-3 rounded-lg border border-primario bg-primario-suave p-3 text-primario-sobre-suave">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{ids.length} seleccionado(s)</strong>
        {selector('Cambiar estado', ESTADOS.map((e) => [e, ETIQUETA_ESTADO[e]]), (v) => aplicar.mutate({ estado: v as Estado }))}
        {selector('Cambiar prioridad', PRIORIDADES.map((p) => [p, ETIQUETA_PRIORIDAD[p]]), (v) => aplicar.mutate({ prioridad: v as Prioridad }))}
        {selector('Asignar a', [['ninguno', 'Sin asignar'], ...tecnicos.map((t) => [t.id, t.nombre] as [string, string])], (v) =>
          aplicar.mutate({ asignadoId: v === 'ninguno' ? null : v }),
        )}
        <Boton variante="fantasma" tamano="sm" onClick={() => limpiar({})}>
          Quitar selección
        </Boton>
      </div>
      {errores.length > 0 && (
        <ul role="alert" className="mt-2 list-disc pl-5 text-sm">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
