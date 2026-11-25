/** Mutaciones de catálogo, usuarios y configuración. La autorización (admin/staff) la exige quien llama. */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Rol } from '@eco/shared/dominio';
import {
  zConfiguracion,
  type Configuracion,
  type zGuardarArea,
  type zGuardarCategoria,
  type zGuardarRespuestaRapida,
} from '@eco/shared/schemas';
import type { z } from 'zod';
import { ErrorHttp, noEncontrado } from '../errores';
import { BLOQUEO } from './bloqueos';
import type { Ejecutor, Tx } from './conexion';
import { leerConfiguracion } from './configuracion';
import { emitirEvento } from './eventos';
import {
  areas,
  categorias,
  configuracion,
  recuperacionesPassword,
  respuestasRapidas,
  sesiones,
  usuarios,
} from './schema';

const invalido = (mensaje: string) => new ErrorHttp(400, 'validacion', mensaje);
const conflicto = (mensaje: string) => new ErrorHttp(409, 'conflicto', mensaje);

/** Violación de unicidad de Postgres (drizzle envuelve el error original en `cause`). */
export function esDuplicado(e: unknown): boolean {
  for (let x = e; x && typeof x === 'object'; x = (x as { cause?: unknown }).cause)
    if ((x as { code?: unknown }).code === '23505') return true;
  return false;
}
async function sinDuplicar<T>(mensaje: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw esDuplicado(e) ? conflicto(mensaje) : e;
  }
}

const catalogo = (tx: Tx, recurso: 'categorias' | 'areas' | 'usuarios' | 'configuracion' | 'respuestas') =>
  emitirEvento(tx, 'catalogo.actualizado', { recurso });

/** Reemplaza la configuración completa. Los vencimientos ya calculados no se modifican. */
export async function guardarConfiguracion(db: Ejecutor, nueva: Configuracion): Promise<Configuracion> {
  const valida = zConfiguracion.parse(nueva);
  return db.transaction(async (tx) => {
    for (const [clave, valor] of Object.entries(valida))
      await tx
        .insert(configuracion)
        .values({ clave, valor, actualizadoAt: new Date() })
        .onConflictDoUpdate({
          target: configuracion.clave,
          set: { valor: sql`excluded.valor`, actualizadoAt: sql`excluded.actualizado_at` },
        });
    await catalogo(tx, 'configuracion');
    return leerConfiguracion(tx);
  });
}

/** Alta (sin `id`) o modificación de una categoría. Devuelve el id. */
export async function guardarCategoria(
  db: Ejecutor,
  datos: z.output<typeof zGuardarCategoria>,
  id?: number,
): Promise<number> {
  const claves = datos.campos.map((c) => c.clave);
  if (new Set(claves).size !== claves.length) throw invalido('Hay campos con la misma clave.');
  if (datos.campos.some((c) => c.tipo === 'seleccion' && !c.opciones?.length))
    throw invalido('Los campos de selección necesitan opciones.');
  if (datos.modoAsignacion === 'fija' && !datos.tecnicoDefaultId)
    throw invalido('Indique el técnico para la asignación fija.');
  return sinDuplicar('Ya existe una categoría con ese nombre.', () =>
    db.transaction(async (tx) => {
      if (datos.padreId !== null) {
        // La cadena de padres no puede volver a la propia categoría.
        let padre: number | null = datos.padreId;
        for (let i = 0; padre !== null; i++) {
          if (padre === id || i > 20) throw invalido('La categoría superior genera un ciclo.');
          const [p]: { padreId: number | null }[] = await tx
            .select({ padreId: categorias.padreId })
            .from(categorias)
            .where(eq(categorias.id, padre));
          if (!p) throw invalido('La categoría superior no existe.');
          padre = p.padreId;
        }
      }
      if (datos.tecnicoDefaultId) {
        const [t] = await tx
          .select({ id: usuarios.id })
          .from(usuarios)
          .where(
            and(
              eq(usuarios.id, datos.tecnicoDefaultId),
              eq(usuarios.activo, true),
              inArray(usuarios.rol, ['tecnico', 'admin']),
            ),
          );
        if (!t) throw invalido('El técnico indicado no está disponible.');
      }
      let resultado = id;
      if (id === undefined) {
        const [max] = await tx.select({ n: sql<number>`coalesce(max(${categorias.orden}), 0)::int` }).from(categorias);
        const [f] = await tx
          .insert(categorias)
          .values({ ...datos, orden: (max?.n ?? 0) + 1 })
          .returning({ id: categorias.id });
        resultado = f!.id;
      } else {
        const r = await tx.update(categorias).set(datos).where(eq(categorias.id, id)).returning({ id: categorias.id });
        if (!r.length) throw noEncontrado('La categoría');
      }
      await catalogo(tx, 'categorias');
      return resultado!;
    }),
  );
}

export async function desactivarCategoria(db: Ejecutor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.update(categorias).set({ activa: false }).where(eq(categorias.id, id)).returning();
    if (!r.length) throw noEncontrado('La categoría');
    await catalogo(tx, 'categorias');
  });
}

/** El orden pasa a ser la posición en `ids`. */
export async function ordenarCategorias(db: Ejecutor, ids: number[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx
        .update(categorias)
        .set({ orden: i + 1 })
        .where(eq(categorias.id, id));
    await catalogo(tx, 'categorias');
  });
}

export async function guardarArea(db: Ejecutor, datos: z.output<typeof zGuardarArea>, id?: number): Promise<number> {
  return sinDuplicar('Ya existe un área con ese nombre.', () =>
    db.transaction(async (tx) => {
      const [f] =
        id === undefined
          ? await tx.insert(areas).values(datos).returning({ id: areas.id })
          : await tx.update(areas).set(datos).where(eq(areas.id, id)).returning({ id: areas.id });
      if (!f) throw noEncontrado('El área');
      await catalogo(tx, 'areas');
      return f.id;
    }),
  );
}

async function exigirArea(tx: Tx, areaId: number | null | undefined) {
  if (areaId === null || areaId === undefined) return;
  const [a] = await tx.select({ id: areas.id }).from(areas).where(eq(areas.id, areaId));
  if (!a) throw invalido('El área indicada no existe.');
}

export interface DatosNuevoUsuario {
  email: string;
  nombre: string;
  rol: Rol;
  areaId: number | null;
  /** Hash argon2id ya calculado. */
  passwordHash?: string | null;
}

export async function crearUsuario(db: Ejecutor, datos: DatosNuevoUsuario): Promise<string> {
  return sinDuplicar('Ya existe un usuario con ese correo.', () =>
    db.transaction(async (tx) => {
      await exigirArea(tx, datos.areaId);
      const [f] = await tx
        .insert(usuarios)
        .values({ ...datos, email: datos.email.trim().toLowerCase() })
        .returning({ id: usuarios.id });
      await catalogo(tx, 'usuarios');
      return f!.id;
    }),
  );
}

export const revocarSesiones = (db: Ejecutor, usuarioId: string) =>
  db
    .update(sesiones)
    .set({ revocadoAt: new Date() })
    .where(and(eq(sesiones.usuarioId, usuarioId), isNull(sesiones.revocadoAt)));

export interface CambiosUsuario {
  nombre?: string;
  rol?: Rol;
  areaId?: number | null;
  activo?: boolean;
  passwordHash?: string | null;
}

/**
 * Modifica un usuario. Si pierde acceso o cambia de rol o área emite `usuario.acceso_cambiado`;
 * al desactivarlo o cambiar la contraseña revoca sus sesiones. No permite quedar sin administradores.
 */
export async function actualizarUsuario(db: Ejecutor, id: string, cambios: CambiosUsuario): Promise<void> {
  await db.transaction(async (tx) => {
    // Serializa los cambios de administradores.
    await tx.execute(sql`select pg_advisory_xact_lock(${BLOQUEO.administradores})`);
    const [u] = await tx.select().from(usuarios).where(eq(usuarios.id, id)).for('update');
    if (!u) throw noEncontrado('El usuario');
    await exigirArea(tx, cambios.areaId);
    const rol = cambios.rol ?? u.rol;
    const activo = cambios.activo ?? u.activo;
    const areaId = cambios.areaId === undefined ? u.areaId : cambios.areaId;
    if (u.rol === 'admin' && u.activo && (rol !== 'admin' || !activo)) {
      const [otro] = await tx
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(and(eq(usuarios.rol, 'admin'), eq(usuarios.activo, true), ne(usuarios.id, id)))
        .limit(1);
      if (!otro) throw conflicto('Debe quedar al menos un administrador activo.');
    }
    await tx
      .update(usuarios)
      .set({ ...cambios, actualizadoAt: new Date() })
      .where(eq(usuarios.id, id));
    const clave = cambios.passwordHash !== undefined && cambios.passwordHash !== u.passwordHash;
    if ((u.activo && !activo) || clave) await revocarSesiones(tx, id);
    if (rol !== u.rol || activo !== u.activo || areaId !== u.areaId)
      await emitirEvento(tx, 'usuario.acceso_cambiado', { usuarioId: id });
    await catalogo(tx, 'usuarios');
  });
}

export interface EmpleadoPersonal {
  email: string;
  nombre: string;
  areaNombre: string | null;
  activo: boolean;
}

/**
 * Ingreso por el portal: crea (como solicitante) o actualiza nombre, área y estado según Personal.
 * El área se vincula por nombre y se crea si falta. Un empleado inactivo sin usuario no se crea (null).
 */
export async function sincronizarUsuarioPersonal(db: Ejecutor, empleado: EmpleadoPersonal): Promise<string | null> {
  const email = empleado.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
    const [u] = await tx
      .select()
      .from(usuarios)
      .where(sql`lower(${usuarios.email}) = ${email}`)
      .for('update');
    if (!u && !empleado.activo) return null;

    let areaId: number | null = null;
    const nombreArea = empleado.areaNombre?.trim();
    if (nombreArea) {
      const buscar = () =>
        tx
          .select({ id: areas.id })
          .from(areas)
          .where(sql`lower(${areas.nombre}) = lower(${nombreArea})`);
      let [a] = await buscar();
      if (!a) {
        await tx.insert(areas).values({ nombre: nombreArea }).onConflictDoNothing();
        [a] = await buscar();
        await catalogo(tx, 'areas');
      }
      areaId = a!.id;
    }
    if (!u) {
      const [f] = await tx
        .insert(usuarios)
        .values({ email, nombre: empleado.nombre, areaId, rol: 'solicitante' })
        .returning({ id: usuarios.id });
      await catalogo(tx, 'usuarios');
      return f!.id;
    }
    if (u.nombre !== empleado.nombre || u.areaId !== areaId || u.activo !== empleado.activo) {
      await tx
        .update(usuarios)
        .set({ nombre: empleado.nombre, areaId, activo: empleado.activo, actualizadoAt: new Date() })
        .where(eq(usuarios.id, u.id));
      if (u.activo && !empleado.activo) await revocarSesiones(tx, u.id);
      if (u.areaId !== areaId || u.activo !== empleado.activo)
        await emitirEvento(tx, 'usuario.acceso_cambiado', { usuarioId: u.id });
      await catalogo(tx, 'usuarios');
    }
    return u.id;
  });
}

export async function guardarRespuestaRapida(
  db: Ejecutor,
  datos: z.output<typeof zGuardarRespuestaRapida>,
  id?: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [f] =
      id === undefined
        ? await tx.insert(respuestasRapidas).values(datos).returning({ id: respuestasRapidas.id })
        : await tx
            .update(respuestasRapidas)
            .set(datos)
            .where(eq(respuestasRapidas.id, id))
            .returning({ id: respuestasRapidas.id });
    if (!f) throw noEncontrado('La respuesta rápida');
    await catalogo(tx, 'respuestas');
    return f.id;
  });
}

export async function eliminarRespuestaRapida(db: Ejecutor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.delete(respuestasRapidas).where(eq(respuestasRapidas.id, id)).returning();
    if (!r.length) throw noEncontrado('La respuesta rápida');
    await catalogo(tx, 'respuestas');
  });
}

/**
 * Registra un pedido de recupero (sin token: lo genera el worker al enviar el mail) e invalida los anteriores.
 * Devuelve el id de la recuperación.
 */
export async function solicitarRecuperacion(
  db: Ejecutor,
  usuarioId: string,
  duracionMin = 60,
  ahora?: Date,
): Promise<string> {
  return db.transaction(async (tx) => {
    const fecha = ahora ?? new Date();
    await tx
      .update(recuperacionesPassword)
      .set({ usadoAt: fecha })
      .where(and(eq(recuperacionesPassword.usuarioId, usuarioId), isNull(recuperacionesPassword.usadoAt)));
    const [f] = await tx
      .insert(recuperacionesPassword)
      .values({ usuarioId, creadoAt: fecha, expiraAt: new Date(fecha.getTime() + duracionMin * 60_000) })
      .returning({ id: recuperacionesPassword.id });
    await emitirEvento(tx, 'auth.recuperacion_solicitada', { recuperacionId: f!.id });
    return f!.id;
  });
}
