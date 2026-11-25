/**
 * Regla de ingreso común al portal y al login local. En cada ingreso se actualizan nombre, área y estado
 * según Personal. Quien no figura en Personal solo entra si ya tiene un usuario local activo.
 */
import { eq } from 'drizzle-orm';
import { buscarUsuarioPorEmail, sincronizarUsuarioPersonal, usuarios, type Ejecutor } from '../db';
import type { PersonalProvider } from './personal';

/**
 * Id del usuario habilitado para ingresar, o null. Si Personal falla se propaga el error, salvo con
 * `tolerarFallo` (login local): ahí valen los datos locales de un usuario ya existente.
 */
export async function resolverIngreso(
  db: Ejecutor,
  personal: PersonalProvider,
  email: string,
  opciones: { tolerarFallo?: boolean; alFallar?: (e: unknown) => void } = {},
): Promise<string | null> {
  let empleado = null;
  try {
    empleado = await personal.buscarPorEmail(email);
  } catch (e) {
    opciones.alFallar?.(e);
    if (!opciones.tolerarFallo) throw e;
  }
  if (empleado)
    await sincronizarUsuarioPersonal(db, {
      email,
      nombre: empleado.nombre,
      areaNombre: empleado.area_nombre,
      activo: empleado.activo,
    });
  const u = await buscarUsuarioPorEmail(db, email);
  return u?.activo ? u.id : null;
}

export const registrarAcceso = (db: Ejecutor, id: string) =>
  db.update(usuarios).set({ ultimoAcceso: new Date() }).where(eq(usuarios.id, id));
