import { useState } from 'react';
import { keepPreviousData, useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { formatearFecha, type Estado } from '@eco/shared/dominio';
import type { TicketResumen } from '@eco/shared/schemas';
import { IconoCategoria } from '../../componentes/IconoCategoria';
import { Contador } from '../../componentes/insignias';
import { Boton, Encabezado, ErrorVista, Esqueletos, EstadoVacio, estilosBoton } from '../../componentes/ui/basicos';
import type { DatosPagina } from '../../lib/cache';
import { qLista, qNoLeidos } from '../../lib/consultas';
import { cn } from '../../lib/cn';
import { useCatalogo, useUsuario } from '../../lib/hooks';

const ruta = getRouteApi('/app/mis-pedidos');

/** Orden de las secciones: primero lo que espera algo de la persona, al final lo terminado. */
const SECCIONES: readonly { estado: Estado; titulo: string; plegada?: boolean }[] = [
  { estado: 'resuelto', titulo: 'Resueltos' },
  { estado: 'en_curso', titulo: 'En curso' },
  { estado: 'en_espera', titulo: 'En espera' },
  { estado: 'asignado', titulo: 'Asignados' },
  { estado: 'nuevo', titulo: 'Nuevos' },
  { estado: 'cerrado', titulo: 'Cerrados', plegada: true },
  { estado: 'cancelado', titulo: 'Cancelados', plegada: true },
];
const INICIALES = 5;
const PASO = 20;
const MAXIMO = 500;

export function MisPedidos() {
  const { ambito } = ruta.useSearch();
  const navegar = ruta.useNavigate();
  const veArea = useCatalogo()?.configuracion.solicitanteVeArea;
  const usuario = useUsuario();
  const area = ambito === 'area' && veArea !== false;
  const [cuantos, setCuantos] = useState<Partial<Record<Estado, number>>>({});
  const noLeidos = useQuery(qNoLeidos).data?.porTicket;
  // Una consulta por estado: ningún pedido queda escondido detrás de una paginación común.
  const consultas = useQueries({
    queries: SECCIONES.map(({ estado }) => ({
      ...qLista({
        ambito: area ? 'area' : 'mios',
        estado: [estado],
        orden: 'actualizadoAt',
        dir: 'desc',
        porPagina: cuantos[estado] ?? INICIALES,
      }),
      placeholderData: keepPreviousData,
    })),
  }) as UseQueryResult<DatosPagina>[];

  const cargando = consultas.some((c) => c.isPending);
  const fallida = consultas.find((c) => c.isError && !c.data);
  const vacio = consultas.every((c) => c.data?.total === 0);

  return (
    <div className="mx-auto max-w-2xl">
      <Encabezado
        titulo="Mis pedidos"
        acciones={
          veArea && usuario.areaId !== null ? (
            <select
              aria-label="Qué pedidos ver"
              className="entrada w-auto"
              value={area ? 'area' : 'mios'}
              onChange={(e) => void navegar({ search: e.target.value === 'area' ? { ambito: 'area' } : {} })}
            >
              <option value="mios">Solo los míos</option>
              <option value="area">De mi área</option>
            </select>
          ) : undefined
        }
      />
      {fallida ? (
        <ErrorVista error={fallida.error} reintentar={() => consultas.forEach((c) => void c.refetch())} />
      ) : cargando ? (
        <Esqueletos filas={4} alto="h-16" />
      ) : vacio ? (
        <EstadoVacio titulo={area ? 'Su área todavía no tiene pedidos' : 'Todavía no tiene pedidos'}>
          Cuando cargue un pedido podrá seguir su avance desde aquí.
          <Link to="/nuevo" className={cn(estilosBoton(), 'mt-4')}>
            Nuevo pedido
          </Link>
        </EstadoVacio>
      ) : (
        <div className="flex flex-col gap-6">
          {SECCIONES.map(({ estado, titulo, plegada }, i) => {
            const datos = consultas[i]!.data!;
            if (!datos.total) return null;
            return (
              <Seccion key={estado} estado={estado} titulo={titulo} total={datos.total} plegada={plegada}>
                <ul className="tarjeta divide-y divide-borde overflow-hidden">
                  {datos.items.map((t) => (
                    <li key={t.id}>
                      <Pedido ticket={t} noLeidos={noLeidos?.[t.id] ?? 0} mostrarSolicitante={area} />
                    </li>
                  ))}
                </ul>
                {datos.total > datos.items.length && datos.items.length < MAXIMO && (
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    className="mt-1 w-full"
                    ocupado={consultas[i]!.isFetching}
                    onClick={() => setCuantos((c) => ({ ...c, [estado]: Math.min((c[estado] ?? INICIALES) + PASO, MAXIMO) }))}
                  >
                    Ver más ({datos.total - datos.items.length})
                  </Boton>
                )}
              </Seccion>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Seccion(p: {
  estado: Estado;
  titulo: string;
  total: number;
  plegada?: boolean;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(!p.plegada);
  const id = `seccion-${p.estado}`;
  return (
    <section data-testid={id} aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`} className="mb-2 text-base">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md py-1 text-left"
          aria-expanded={abierta}
          aria-controls={`${id}-lista`}
          onClick={() => setAbierta(!abierta)}
        >
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            // El resuelto usa fondo oscuro y texto claro: para el punto sirve el fondo.
            style={{ background: `var(--estado-${p.estado}-${p.estado === 'resuelto' ? 'fondo' : 'texto'})` }}
          />
          {p.titulo}
          <span className="font-normal text-suave">{p.total}</span>
          <ChevronDown aria-hidden className={cn('ml-auto size-4 text-suave', !abierta && '-rotate-90')} />
        </button>
      </h2>
      <div id={`${id}-lista`} hidden={!abierta}>
        {p.children}
      </div>
    </section>
  );
}

function Pedido({ ticket: t, noLeidos, mostrarSolicitante }: { ticket: TicketResumen; noLeidos: number; mostrarSolicitante: boolean }) {
  return (
    <Link
      to="/tickets/$id"
      params={{ id: t.codigo }}
      data-testid={`tarjeta-${t.codigo}`}
      className="flex items-center gap-3 p-3 hover:bg-superficie-2"
    >
      <IconoCategoria nombre={t.categoriaIcono} className="size-5 shrink-0 text-primario" />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-semibold', noLeidos > 0 && 'font-bold')}>{t.titulo}</span>
        {noLeidos > 0 && t.ultimoMensaje && (
          <span className="block truncate text-sm">
            {t.ultimoMensaje.autorNombre}: {t.ultimoMensaje.extracto}
          </span>
        )}
        <span className="block truncate text-xs text-suave">
          {t.categoriaNombre} · {formatearFecha(t.actualizadoAt)} · {t.codigo}
          {mostrarSolicitante ? ` · ${t.solicitante.nombre}` : ''}
        </span>
      </span>
      <Contador n={noLeidos} etiqueta="mensajes sin leer" />
    </Link>
  );
}
