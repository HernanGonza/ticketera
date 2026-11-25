import type { Rol } from './tipos';

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  areaId: number | null;
}

export const esStaff = (u: Pick<UsuarioSesion, 'rol'>) => u.rol === 'tecnico' || u.rol === 'admin';
export const esAdmin = (u: Pick<UsuarioSesion, 'rol'>) => u.rol === 'admin';

export interface TicketAcceso {
  solicitanteId: string;
  areaId: number | null;
}

/** Regla única de lectura de un ticket: la usan los endpoints y las salas de Socket.IO. */
export function puedeVerTicket(
  u: Pick<UsuarioSesion, 'id' | 'rol' | 'areaId'>,
  t: TicketAcceso,
  opciones: { solicitanteVeArea: boolean },
): boolean {
  if (esStaff(u)) return true;
  if (t.solicitanteId === u.id) return true;
  return opciones.solicitanteVeArea && u.areaId !== null && t.areaId === u.areaId;
}

/** Solicitantes de la misma área pueden leer, pero solo el dueño (o staff) escribe, adjunta, reabre o califica. */
export function puedeEscribirTicket(
  u: Pick<UsuarioSesion, 'id' | 'rol'>,
  t: Pick<TicketAcceso, 'solicitanteId'>,
): boolean {
  return esStaff(u) || t.solicitanteId === u.id;
}
