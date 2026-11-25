/** Quiénes reciben avisos de un ticket. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { categorias, mensajes, usuarios, type Ejecutor } from '@eco/api/db';
import { esStaff, type Rol } from '@eco/shared/dominio';

export interface Destinatario {
  id: string;
  rol: Rol;
}

/** Solo usuarios activos, sin repetidos. */
export async function activos(db: Ejecutor, ids: readonly (string | null | undefined)[]): Promise<Destinatario[]> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return [];
  return db
    .select({ id: usuarios.id, rol: usuarios.rol })
    .from(usuarios)
    .where(and(inArray(usuarios.id, unicos), eq(usuarios.activo, true)));
}

/**
 * Técnicos que atienden una categoría: el fijo en modo `fija`; en los demás, todos los técnicos.
 * Si no hay ninguno, los administradores.
 */
export async function tecnicosDeCategoria(db: Ejecutor, categoriaId: number): Promise<string[]> {
  const [c] = await db
    .select({ modo: categorias.modoAsignacion, tecnico: categorias.tecnicoDefaultId })
    .from(categorias)
    .where(eq(categorias.id, categoriaId));
  if (c?.modo === 'fija' && c.tecnico) {
    const [u] = await activos(db, [c.tecnico]);
    if (u && esStaff(u)) return [u.id];
  }
  const deRol = async (rol: Rol) =>
    (
      await db
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(and(eq(usuarios.rol, rol), eq(usuarios.activo, true)))
    ).map((u) => u.id);
  const tecnicos = await deRol('tecnico');
  return tecnicos.length ? tecnicos : deRol('admin');
}

/** Staff activo que escribió en el ticket (incluye notas internas). */
export async function staffParticipante(db: Ejecutor, ticketId: string): Promise<string[]> {
  const filas = await db
    .selectDistinct({ id: usuarios.id })
    .from(mensajes)
    .innerJoin(usuarios, eq(usuarios.id, mensajes.autorId))
    .where(and(eq(mensajes.ticketId, ticketId), eq(usuarios.activo, true), sql`${usuarios.rol} <> 'solicitante'`));
  return filas.map((f) => f.id);
}
