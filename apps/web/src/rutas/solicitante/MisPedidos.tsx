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

/** Columnas en el orden en que avanza un pedido. Lo terminado va abajo, plegado. */
const SECCIONES: readonly { estado: Estado; titulo: string; plegada?: boolean }[] = [
  { estado: 'nuevo', titulo: 'Nuevos' },
  { estado: 'asignado', titulo: 'Asignados' },
  { estado: 'en_curso', titulo: 'En curso' },
  { estado: 'en_espera', titulo: 'En espera' },
  { estado: 'resuelto', titulo: 'Resueltos' },
  { estado: 'cerrado', titulo: 'Cerrados', plegada: true },
  { estado: 'cancelado', titulo: 'Cancelados', plegada: true },
];
/** El resuelto usa fondo oscuro y texto claro: como color de marco o punto sirve su fondo. */
const acentoEstado = (e: Estado) => `var(--estado-${e}-${e === 'resuelto' ? 'fondo' : 'texto'})`;
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
    <div className="mx-auto max-w-7xl">
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
        <div className="flex flex-col gap-8">
          <div className="grid items-start gap-5 md:grid-cols-3 md:gap-3 xl:grid-cols-5">
            {SECCIONES.map((x, i) => !x.plegada && columna(x, i))}
          </div>
          {SECCIONES.map((x, i) => x.plegada && columna(x, i))}
        </div>
      )}
    </div>
  );

  function columna({ estado, titulo, plegada }: (typeof SECCIONES)[number], i: number) {
    const datos = consultas[i]!.data!;
    if (!datos.total && plegada) return null;
    return (
      <Seccion
        key={estado}
        estado={estado}
        titulo={titulo}
        total={datos.total}
        plegada={plegada}
        // En el celular las columnas se apilan: las vacías no ocupan lugar.
        className={datos.total ? undefined : 'max-md:hidden'}
      >
        {datos.total ? (
          <ul className={cn('grid gap-2', plegada && 'md:grid-cols-3 xl:grid-cols-5')}>
            {datos.items.map((t) => (
              <li key={t.id} className="flex">
                <Pedido ticket={t} noLeidos={noLeidos?.[t.id] ?? 0} mostrarSolicitante={area} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-borde-fuerte p-4 text-center text-sm text-suave">Sin pedidos</p>
        )}
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
  }
}

function Seccion(p: {
  estado: Estado;
  titulo: string;
  total: number;
  plegada?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(!p.plegada);
  const id = `seccion-${p.estado}`;
  const rotulo = (
    <>
      <span aria-hidden className="size-2.5 rounded-full" style={{ background: acentoEstado(p.estado) }} />
      {p.titulo}
      <span className="font-normal text-suave">{p.total}</span>
    </>
  );
  return (
    <section data-testid={id} aria-labelledby={`${id}-titulo`} className={cn('min-w-0', p.className)}>
      <h2 id={`${id}-titulo`} className="mb-2 text-base">
        {p.plegada ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md py-1 text-left"
            aria-expanded={abierta}
            aria-controls={`${id}-lista`}
            onClick={() => setAbierta(!abierta)}
          >
            {rotulo}
            <ChevronDown aria-hidden className={cn('size-4 text-suave', !abierta && '-rotate-90')} />
          </button>
        ) : (
          <span className="flex items-center gap-2 border-b-2 pb-2" style={{ borderColor: acentoEstado(p.estado) }}>
            {rotulo}
          </span>
        )}
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
      className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg border-2 p-3 shadow-sm transition-shadow hover:shadow-md"
      // Pares fondo/texto de cada estado: contraste AA verificado en tokens.css.
      style={{
        background: `var(--estado-${t.estado}-fondo)`,
        color: `var(--estado-${t.estado}-texto)`,
        borderColor: acentoEstado(t.estado),
      }}
    >
      <span className="flex items-start gap-2">
        <IconoCategoria nombre={t.categoriaIcono} className="mt-0.5 size-5 shrink-0" />
        <span className={cn('line-clamp-2 min-w-0 flex-1 font-semibold break-words', noLeidos > 0 && 'font-bold')}>{t.titulo}</span>
        <Contador n={noLeidos} etiqueta="mensajes sin leer" />
      </span>
      {noLeidos > 0 && t.ultimoMensaje && (
        <span className="line-clamp-2 text-sm break-words">
          {t.ultimoMensaje.autorNombre}: {t.ultimoMensaje.extracto}
        </span>
      )}
      <span className="text-xs">
        {t.categoriaNombre} · {formatearFecha(t.actualizadoAt)}
        <span className="block">
          {t.codigo}
          {mostrarSolicitante ? ` · ${t.solicitante.nombre}` : ''}
        </span>
      </span>
    </Link>
  );
}
