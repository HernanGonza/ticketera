/** Mutaciones optimistas de tickets: en cola por ticket, con control de versión y reversión. */
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TicketDetalle, TicketResumen } from '@eco/shared/schemas';
import { ErrorApiCliente } from './api';
import {
  aplicarEnKanban,
  aplicarEnPagina,
  quitarParche,
  registrarParche,
  type DatosKanban,
  type DatosPagina,
  type Parche,
} from './cache';
import { avisarError, claves } from './consultas';

export const MENSAJE_CONFLICTO = 'Otro técnico modificó este ticket';

/** Escribe un resumen en todas las consultas que lo contienen (kanban, listas y detalle). */
export function escribirTicket(qc: QueryClient, ticket: TicketResumen) {
  qc.setQueryData<DatosKanban>(claves.kanban, (d) => (d ? aplicarEnKanban(d, ticket) : d));
  qc.setQueriesData<DatosPagina>({ queryKey: claves.listas }, (d) => (d ? aplicarEnPagina(d, ticket) : d));
  // La función `structuralSharing` del detalle descarta versiones viejas.
  qc.setQueriesData<TicketDetalle>({ queryKey: claves.detalles }, (d) =>
    d && d.id === ticket.id && ticket.version >= d.version ? { ...d, ...ticket } : d,
  );
}

/** Copia más reciente del ticket presente en la caché. */
export function buscarTicket(qc: QueryClient, id: string): TicketResumen | undefined {
  const candidatos: TicketResumen[] = [];
  const k = qc.getQueryData<DatosKanban>(claves.kanban)?.tickets.find((t) => t.id === id);
  if (k) candidatos.push(k);
  for (const [, d] of qc.getQueriesData<TicketDetalle>({ queryKey: claves.detalles }))
    if (d?.id === id) candidatos.push(d);
  for (const [, d] of qc.getQueriesData<DatosPagina>({ queryKey: claves.listas })) {
    const t = d?.items.find((x) => x.id === id);
    if (t) candidatos.push(t);
  }
  return candidatos.sort((a, b) => b.version - a.version)[0];
}

const colas = new Map<string, Promise<unknown>>();
const generaciones = new Map<string, number>();

export interface Mutacion<R extends TicketResumen> {
  id: string;
  parche: Parche;
  enviar: (version: number) => Promise<R>;
}

/**
 * Aplica el parche de inmediato y confirma contra el servidor. Devuelve `null` si se revirtió.
 * Ante `conflicto_version` muestra el aviso y deja la versión del servidor.
 */
export function mutarTicket<R extends TicketResumen>(qc: QueryClient, m: Mutacion<R>): Promise<R | null> {
  const previo = buscarTicket(qc, m.id);
  const generacion = generaciones.get(m.id) ?? 0;
  const token = registrarParche(m.id, m.parche);
  if (previo) escribirTicket(qc, { ...previo, ...m.parche });

  const revertir = () => {
    quitarParche(m.id, token);
    const actual = buscarTicket(qc, m.id);
    if (actual && previo) {
      const anterior = Object.fromEntries(Object.keys(m.parche).map((k) => [k, previo[k as keyof TicketResumen]]));
      escribirTicket(qc, { ...actual, ...(anterior as Parche) });
    }
    void qc.invalidateQueries({ queryKey: claves.tickets });
    void qc.invalidateQueries({ queryKey: claves.detalles });
  };

  const ejecutar = async (): Promise<R | null> => {
    // Un fallo anterior sobre el mismo ticket anula lo encolado detrás.
    if ((generaciones.get(m.id) ?? 0) !== generacion) {
      revertir();
      return null;
    }
    const version = buscarTicket(qc, m.id)?.version ?? previo?.version ?? 0;
    try {
      const r = await m.enviar(version);
      quitarParche(m.id, token);
      // Si ya llegó algo más nuevo, el parche pudo haber tapado sus valores: se vuelve a pedir.
      if ((buscarTicket(qc, m.id)?.version ?? 0) > r.version) {
        void qc.invalidateQueries({ queryKey: claves.tickets });
        void qc.invalidateQueries({ queryKey: claves.detalles });
      }
      escribirTicket(qc, r);
      return r;
    } catch (e) {
      generaciones.set(m.id, generacion + 1);
      revertir();
      if (e instanceof ErrorApiCliente && e.codigo === 'conflicto_version') {
        const servidor = (e.detalles as { ticket?: TicketResumen } | undefined)?.ticket;
        if (servidor) escribirTicket(qc, servidor);
        toast.warning(MENSAJE_CONFLICTO, { id: `conflicto-${m.id}` });
      } else avisarError(e);
      return null;
    }
  };

  const tarea = (colas.get(m.id) ?? Promise.resolve()).then(ejecutar);
  colas.set(
    m.id,
    tarea.finally(() => {
      if (colas.size > 500) colas.clear();
    }),
  );
  return tarea;
}
