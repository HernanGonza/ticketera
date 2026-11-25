/** Acciones de gestión sobre un ticket, todas optimistas y con control de versión. */
import type { QueryClient } from '@tanstack/react-query';
import type { Estado, Prioridad } from '@eco/shared/dominio';
import type { Categoria, Persona, TicketDetalle, TicketResumen } from '@eco/shared/schemas';
import { api } from './api';
import type { Parche } from './cache';
import { claves } from './consultas';
import { parcheDeEstado } from './kanban';
import { mutarTicket } from './optimista';

type Cambios = { estado?: Estado; prioridad?: Prioridad; categoriaId?: number; asignadoId?: string | null };

function actualizar(qc: QueryClient, id: string, cambios: Cambios, parche: Parche) {
  return mutarTicket<TicketDetalle>(qc, {
    id,
    parche,
    enviar: (version) => api(`/api/tickets/${id}`, { metodo: 'PATCH', cuerpo: { version, ...cambios } }),
  }).then((r) => {
    if (r) void qc.invalidateQueries({ queryKey: claves.eventos(id) });
    return r;
  });
}

export const cambiarEstado = (qc: QueryClient, t: TicketResumen, estado: Estado, yo: Persona) =>
  actualizar(qc, t.id, { estado }, parcheDeEstado(t, estado, yo));
export const cambiarPrioridad = (qc: QueryClient, t: TicketResumen, prioridad: Prioridad) =>
  actualizar(qc, t.id, { prioridad }, { prioridad });
export const asignar = (qc: QueryClient, t: TicketResumen, tecnico: Persona | null) =>
  actualizar(qc, t.id, { asignadoId: tecnico?.id ?? null }, { asignado: tecnico });
export const cambiarCategoria = (qc: QueryClient, t: TicketResumen, c: Categoria) =>
  actualizar(
    qc,
    t.id,
    { categoriaId: c.id },
    { categoriaId: c.id, categoriaNombre: c.nombre, categoriaIcono: c.icono },
  );
