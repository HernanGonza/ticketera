import type { Mensaje, TicketResumen } from '@eco/shared/schemas';

export function ticket(p: Partial<TicketResumen> = {}): TicketResumen {
  return {
    id: 't1',
    codigo: 'TCK-2026-000001',
    titulo: 'Sin internet',
    estado: 'nuevo',
    prioridad: 'media',
    categoriaId: 1,
    categoriaNombre: 'Internet/Red',
    categoriaIcono: 'network',
    areaId: 1,
    areaNombre: 'Bosques',
    solicitante: { id: 's1', nombre: 'Ana Pérez' },
    asignado: null,
    ordenKanban: 1,
    creadoAt: '2026-11-23T12:00:00Z',
    actualizadoAt: '2026-11-23T12:00:00Z',
    primeraRespuestaAt: null,
    resueltoAt: null,
    venceRespuestaAt: '2026-11-23T14:00:00Z',
    venceResolucionAt: '2026-11-24T14:00:00Z',
    slaRespuestaMin: 120,
    slaResolucionMin: 960,
    enEsperaDesde: null,
    ultimoMensaje: null,
    version: 1,
    ...p,
  };
}

export function mensaje(p: Partial<Mensaje> = {}): Mensaje {
  return {
    id: 'm1',
    ticketId: 't1',
    autor: { id: 's1', nombre: 'Ana Pérez', esStaff: false },
    cuerpo: 'Hola',
    interno: false,
    clienteId: null,
    creadoAt: '2026-11-23T12:00:00Z',
    editadoAt: null,
    adjuntos: [],
    ...p,
  };
}
