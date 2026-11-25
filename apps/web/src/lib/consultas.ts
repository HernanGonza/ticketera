/** Claves y opciones de TanStack Query compartidas por todas las pantallas. */
import { MutationCache, QueryCache, QueryClient, queryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  Catalogo,
  Estadisticas,
  NoLeidos,
  TicketDetalle,
  TicketEvento,
  FiltroTickets,
  FiltroEstadisticas,
} from '@eco/shared/schemas';
import { api, aQuery, ErrorApiCliente } from './api';
import {
  compartirDetalle,
  compartirKanban,
  compartirMensajes,
  compartirPagina,
  type DatosKanban,
  type DatosMensajes,
  type DatosNotificaciones,
  type DatosPagina,
} from './cache';

export function avisarError(e: unknown) {
  if (e instanceof ErrorApiCliente) {
    if (e.codigo === 'no_autenticado') return;
    toast.error(e.message, { id: `error-${e.codigo}-${e.message}` });
  } else toast.error('Ocurrió un error inesperado.', { id: 'error-inesperado' });
}

export function crearQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (n, e) => n < 1 && e instanceof ErrorApiCliente && (e.status === 0 || e.status >= 500),
      },
    },
    queryCache: new QueryCache({
      onError: (e, q) => {
        if (q.meta?.silencioso || (e instanceof ErrorApiCliente && e.status === 404)) return;
        avisarError(e);
      },
    }),
    mutationCache: new MutationCache({
      onError: (e, _v, _c, m) => {
        if (!m.meta?.silencioso) avisarError(e);
      },
    }),
  });
}

export const claves = {
  sesion: ['sesion'] as const,
  authConfig: ['auth-config'] as const,
  catalogo: ['catalogo'] as const,
  tickets: ['tickets'] as const,
  listas: ['tickets', 'lista'] as const,
  kanban: ['tickets', 'kanban'] as const,
  detalles: ['ticket'] as const,
  mensajes: (id: string) => ['mensajes', id] as const,
  eventos: (id: string) => ['eventos', id] as const,
  noLeidos: ['no-leidos'] as const,
  notificaciones: ['notificaciones'] as const,
  estadisticas: ['estadisticas'] as const,
  usuarios: ['usuarios'] as const,
  colas: ['colas'] as const,
};

export const qCatalogo = queryOptions({
  queryKey: claves.catalogo,
  queryFn: ({ signal }) => api<Catalogo>('/api/catalogo', { signal }),
  staleTime: 5 * 60_000,
});
export const qKanban = queryOptions({
  queryKey: claves.kanban,
  queryFn: ({ signal }) => api<DatosKanban>('/api/kanban', { signal }),
  structuralSharing: (v, n) => compartirKanban(v as DatosKanban | undefined, n as DatosKanban),
});
export const qLista = (f: FiltroTickets) =>
  queryOptions({
    queryKey: [...claves.listas, f] as const,
    queryFn: ({ signal }) => api<DatosPagina>(`/api/tickets${aQuery(f)}`, { signal }),
    structuralSharing: (v, n) => compartirPagina(v as DatosPagina | undefined, n as DatosPagina),
  });
export const qTicket = (ref: string) =>
  queryOptions({
    queryKey: [...claves.detalles, ref] as const,
    queryFn: ({ signal }) => api<TicketDetalle>(`/api/tickets/${encodeURIComponent(ref)}`, { signal }),
    structuralSharing: (v, n) => compartirDetalle(v as TicketDetalle | undefined, n as TicketDetalle),
  });
export const qMensajes = (id: string) =>
  queryOptions({
    queryKey: claves.mensajes(id),
    queryFn: ({ signal }) => api<DatosMensajes>(`/api/tickets/${id}/mensajes`, { signal }),
    structuralSharing: (v, n) => compartirMensajes(v as DatosMensajes | undefined, n as DatosMensajes),
  });
export const qEventos = (id: string) =>
  queryOptions({
    queryKey: claves.eventos(id),
    queryFn: ({ signal }) => api<{ items: TicketEvento[] }>(`/api/tickets/${id}/eventos`, { signal }),
  });
export const qNoLeidos = queryOptions({
  queryKey: claves.noLeidos,
  queryFn: ({ signal }) => api<NoLeidos>('/api/no-leidos', { signal }),
  meta: { silencioso: true },
});
export const qNotificaciones = queryOptions({
  queryKey: claves.notificaciones,
  queryFn: ({ signal }) => api<DatosNotificaciones>('/api/notificaciones', { signal }),
  meta: { silencioso: true },
});
export const qEstadisticas = (f: FiltroEstadisticas) =>
  queryOptions({
    queryKey: [...claves.estadisticas, f] as const,
    queryFn: ({ signal }) => api<Estadisticas>(`/api/estadisticas${aQuery(f)}`, { signal }),
  });
