import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { formatearFechaHora } from '@eco/shared/dominio';
import type { TicketResumen } from '@eco/shared/schemas';
import { IconoCategoria } from '../../componentes/IconoCategoria';
import { Contador, InsigniaEstado } from '../../componentes/insignias';
import { Encabezado, ErrorVista, Esqueletos, EstadoVacio, estilosBoton, Paginador } from '../../componentes/ui/basicos';
import { qLista, qNoLeidos } from '../../lib/consultas';
import { cn } from '../../lib/cn';
import { useCatalogo, useUsuario } from '../../lib/hooks';

const ruta = getRouteApi('/app/mis-pedidos');
const POR_PAGINA = 20;

export function MisPedidos() {
  const { ambito = 'mios', pagina = 1 } = ruta.useSearch();
  const navegar = ruta.useNavigate();
  const veArea = useCatalogo()?.configuracion.solicitanteVeArea;
  const usuario = useUsuario();
  const area = ambito === 'area' && veArea !== false;
  const consulta = useQuery({
    ...qLista({ ambito: area ? 'area' : 'mios', orden: 'actualizadoAt', dir: 'desc', pagina, porPagina: POR_PAGINA }),
    placeholderData: keepPreviousData,
  });
  const noLeidos = useQuery(qNoLeidos).data?.porTicket;

  return (
    <div className="mx-auto max-w-3xl">
      <Encabezado
        titulo="Mis pedidos"
        acciones={
          <Link to="/nuevo" className={estilosBoton()}>
            <Plus aria-hidden className="size-4" /> Nuevo pedido
          </Link>
        }
      />
      {veArea && usuario.areaId !== null && (
        <div role="group" aria-label="Qué pedidos ver" className="mb-3 inline-flex rounded-md border border-borde-fuerte p-0.5">
          {(['mios', 'area'] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={(a === 'area') === area}
              onClick={() => void navegar({ search: a === 'area' ? { ambito: 'area' } : {} })}
              className={cn('rounded-sm px-4 py-1.5 text-sm font-semibold', (a === 'area') === area && 'bg-primario text-primario-texto')}
            >
              {a === 'mios' ? 'Míos' : 'De mi área'}
            </button>
          ))}
        </div>
      )}
      {consulta.isPending ? (
        <Esqueletos filas={5} alto="h-24" />
      ) : !consulta.data ? (
        <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />
      ) : !consulta.data.items.length ? (
        <EstadoVacio titulo={area ? 'Su área todavía no tiene pedidos' : 'Todavía no tiene pedidos'}>
          Cuando cargue un pedido podrá seguir su avance desde aquí.
        </EstadoVacio>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {consulta.data.items.map((t) => (
              <li key={t.id}>
                <Pedido ticket={t} noLeidos={noLeidos?.[t.id] ?? 0} mostrarSolicitante={area} />
              </li>
            ))}
          </ul>
          <Paginador
            pagina={pagina}
            porPagina={POR_PAGINA}
            total={consulta.data.total}
            cambiar={(p) => void navegar({ search: (s) => ({ ...s, pagina: p }) })}
          />
        </>
      )}
    </div>
  );
}

function Pedido({ ticket: t, noLeidos, mostrarSolicitante }: { ticket: TicketResumen; noLeidos: number; mostrarSolicitante: boolean }) {
  return (
    <Link
      to="/tickets/$id"
      params={{ id: t.codigo }}
      data-testid={`tarjeta-${t.codigo}`}
      className="tarjeta flex gap-3 p-3 hover:border-primario md:p-4"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primario-suave text-primario-sobre-suave">
        <IconoCategoria nombre={t.categoriaIcono} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-suave">{t.codigo}</span>
          <InsigniaEstado estado={t.estado} />
          <Contador n={noLeidos} etiqueta="mensajes sin leer" />
        </span>
        <span className={cn('mt-0.5 block font-semibold break-words', noLeidos > 0 && 'font-bold')}>{t.titulo}</span>
        <span className="block truncate text-sm text-suave">
          {t.ultimoMensaje ? `${t.ultimoMensaje.autorNombre}: ${t.ultimoMensaje.extracto}` : 'Sin mensajes todavía'}
        </span>
        <span className="block text-xs text-suave">
          {t.categoriaNombre} · Actualizado {formatearFechaHora(t.actualizadoAt)}
          {mostrarSolicitante ? ` · ${t.solicitante.nombre}` : ''}
        </span>
      </span>
    </Link>
  );
}
