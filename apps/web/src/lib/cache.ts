/**
 * Reglas puras para conciliar REST, eventos en vivo y cambios optimistas en la caché.
 * Se aplican como `structuralSharing` de las consultas: toda escritura (respuesta HTTP,
 * evento o parche) pasa por acá y conserva referencias si nada cambió (sin parpadeos).
 */
import { replaceEqualDeep } from '@tanstack/react-query';
import type { Mensaje, Notificacion, TicketDetalle, TicketResumen } from '@eco/shared/schemas';

export type Parche = Partial<TicketResumen>;

/* ---------- Cambios optimistas pendientes de confirmación ---------- */
const pendientes = new Map<string, Map<number, Parche>>();
let siguiente = 0;

export function registrarParche(ticketId: string, parche: Parche): number {
  const m = pendientes.get(ticketId) ?? new Map<number, Parche>();
  pendientes.set(ticketId, m);
  m.set(++siguiente, parche);
  return siguiente;
}
export function quitarParche(ticketId: string, token: number) {
  const m = pendientes.get(ticketId);
  m?.delete(token);
  if (m && !m.size) pendientes.delete(ticketId);
}
export function parchePendiente(ticketId: string): Parche | undefined {
  const m = pendientes.get(ticketId);
  return m ? Object.assign({}, ...m.values()) : undefined;
}

/* ---------- Tickets ---------- */

/** Aplica `entrante` sobre `actual` ignorando versiones viejas y respetando parches pendientes. */
export function fusionarTicket<T extends TicketResumen>(actual: T | undefined, entrante: TicketResumen): T {
  if (actual && actual.id === entrante.id && entrante.version < actual.version) return actual;
  const parche = parchePendiente(entrante.id);
  const unido = { ...(actual?.id === entrante.id ? actual : undefined), ...entrante, ...parche } as T;
  return actual ? replaceEqualDeep(actual, unido) : unido;
}

export interface DatosKanban {
  tickets: TicketResumen[];
}

/** Inserta o reemplaza una tarjeta. Los cancelados no tienen columna. */
export function aplicarEnKanban(datos: DatosKanban, ticket: TicketResumen): DatosKanban {
  const i = datos.tickets.findIndex((t) => t.id === ticket.id);
  const actual = datos.tickets[i];
  const nuevo = fusionarTicket(actual, ticket);
  if (nuevo === actual) return datos;
  const tickets = datos.tickets.slice();
  if (nuevo.estado === 'cancelado') {
    if (i < 0) return datos;
    tickets.splice(i, 1);
  } else if (i < 0) tickets.push(nuevo);
  else tickets[i] = nuevo;
  return { ...datos, tickets };
}

/** Conciliación de una respuesta completa del kanban con lo que ya hay en caché. */
export function compartirKanban(viejo: DatosKanban | undefined, nuevo: DatosKanban): DatosKanban {
  if (!viejo) return nuevo;
  const previos = new Map(viejo.tickets.map((t) => [t.id, t]));
  return replaceEqualDeep(viejo, { ...nuevo, tickets: nuevo.tickets.map((t) => fusionarTicket(previos.get(t.id), t)) });
}

export interface DatosPagina {
  items: TicketResumen[];
  total: number;
}
export function aplicarEnPagina(datos: DatosPagina, ticket: TicketResumen): DatosPagina {
  const i = datos.items.findIndex((t) => t.id === ticket.id);
  const actual = datos.items[i];
  if (!actual) return datos;
  const nuevo = fusionarTicket(actual, ticket);
  if (nuevo === actual) return datos;
  const items = datos.items.slice();
  items[i] = nuevo;
  return { ...datos, items };
}
export function compartirPagina(viejo: DatosPagina | undefined, nuevo: DatosPagina): DatosPagina {
  if (!viejo) return nuevo;
  const previos = new Map(viejo.items.map((t) => [t.id, t]));
  return replaceEqualDeep(viejo, { ...nuevo, items: nuevo.items.map((t) => fusionarTicket(previos.get(t.id), t)) });
}

/** El detalle conserva sus campos propios cuando solo llega el resumen. */
export function compartirDetalle(viejo: TicketDetalle | undefined, nuevo: TicketDetalle): TicketDetalle {
  return fusionarTicket<TicketDetalle>(viejo, nuevo);
}

/* ---------- Mensajes ---------- */
export type MensajeLocal = Mensaje & { envio?: 'enviando' | 'error' };

/** clienteId de mensajes optimistas que deben sobrevivir a una recarga. */
export const enviosPendientes = new Set<string>();

const mismo = (a: MensajeLocal, b: MensajeLocal) =>
  a.id === b.id || (!!b.clienteId && a.clienteId === b.clienteId && a.autor.id === b.autor.id);
const porFecha = (a: Mensaje, b: Mensaje) => Date.parse(a.creadoAt) - Date.parse(b.creadoAt);

/** Inserta o concilia un mensaje (por id o clienteId) sin duplicar ni retroceder ediciones. */
export function insertarMensaje(items: MensajeLocal[], m: MensajeLocal): MensajeLocal[] {
  const i = items.findIndex((x) => mismo(x, m));
  const actual = items[i];
  if (!actual) {
    const r = [...items, m];
    return r.sort(porFecha);
  }
  // Un eco optimista nunca pisa al mensaje confirmado; una edición vieja no pisa una nueva.
  if (m.envio && !actual.envio) return items;
  if (actual.editadoAt && (!m.editadoAt || Date.parse(m.editadoAt) < Date.parse(actual.editadoAt))) return items;
  // El evento puede llegar antes de que terminen de subirse los adjuntos.
  const adjuntos = m.adjuntos.length >= actual.adjuntos.length ? m.adjuntos : actual.adjuntos;
  const nuevo = replaceEqualDeep(actual, { ...m, adjuntos } as MensajeLocal);
  if (nuevo === actual) return items;
  const r = items.slice();
  r[i] = nuevo;
  return r;
}

export interface DatosMensajes {
  items: MensajeLocal[];
}
export function compartirMensajes(viejo: DatosMensajes | undefined, nuevo: DatosMensajes): DatosMensajes {
  if (!viejo) return nuevo;
  let items = nuevo.items;
  for (const m of viejo.items)
    if (m.envio && m.clienteId && enviosPendientes.has(m.clienteId) && !items.some((x) => mismo(x, m)))
      items = insertarMensaje(items, m);
  return replaceEqualDeep(viejo, { ...nuevo, items });
}

/* ---------- Notificaciones ---------- */
export interface DatosNotificaciones {
  items: Notificacion[];
  sinLeer: number;
}
export function insertarNotificacion(d: DatosNotificaciones, n: Notificacion): DatosNotificaciones {
  if (d.items.some((x) => x.id === n.id)) return d;
  return { items: [n, ...d.items].slice(0, 50), sinLeer: d.sinLeer + (n.leida ? 0 : 1) };
}
export function marcarLeidas(d: DatosNotificaciones, ids?: number[]): DatosNotificaciones {
  const items = d.items.map((n) => (!n.leida && (!ids || ids.includes(n.id)) ? { ...n, leida: true } : n));
  const marcadas = d.items.filter((n, i) => n !== items[i]).length;
  return { items, sinLeer: ids ? Math.max(0, d.sinLeer - marcadas) : 0 };
}
