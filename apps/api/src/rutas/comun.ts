import { z } from 'zod';
import { puedeEscribirTicket, puedeVerTicket, type UsuarioSesion } from '@eco/shared/dominio';
import { zError, zIdNum } from '@eco/shared/schemas';
import { accesoTicket, leerConfiguracion, type Ejecutor } from '../db';
import { noEncontrado, sinPermiso } from '../errores';

/** Respuestas documentadas de una ruta: la exitosa y las de error. */
export const respuestas = <T extends z.ZodType>(esquema: T, estado: 200 | 201 = 200) =>
  ({ [estado]: esquema, '4xx': zError, 500: zError }) as { 200: T; 201: T; '4xx': typeof zError; 500: typeof zError };

export const CON_SESION = [{ sesion: [] }];

/** `:id` de ticket: uuid o código. */
export const zRefTicket = z.object({ id: z.string().min(1).max(40) });
export const zParamNum = z.object({ id: zIdNum });
export const zParamUuid = z.object({ id: z.uuid() });

/** Ticket visible para el usuario; uno ajeno o inexistente responde 404. */
export async function ticketVisible(db: Ejecutor, ref: string, u: UsuarioSesion) {
  const [acceso, config] = await Promise.all([accesoTicket(db, ref), leerConfiguracion(db)]);
  if (!acceso || !puedeVerTicket(u, acceso, config)) throw noEncontrado('El ticket');
  return { ...acceso, config };
}

/** Como `ticketVisible`, exigiendo además permiso de escritura (403 a quien solo puede leer). */
export async function ticketEditable(db: Ejecutor, ref: string, u: UsuarioSesion) {
  const t = await ticketVisible(db, ref, u);
  if (!puedeEscribirTicket(u, t)) throw sinPermiso();
  return t;
}
