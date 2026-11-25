/** Sesiones: cookie de acceso corta + refresh opaco, rotativo, guardado solo como hash. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UsuarioActual } from '@eco/shared/schemas';
import { obtenerUsuarioSesion, sesiones, type Ejecutor } from '../db';
import type { Deps } from '../deps';
import {
  COOKIE_REFRESH,
  COOKIE_SESION,
  DURACION_REFRESH_SEG,
  DURACION_SESION_SEG,
  firmarSesion,
  verificarSesion,
} from './sesion';

/** Dos pestañas pueden refrescar a la vez con el mismo token: dentro de esta ventana no es reuso. */
export const GRACIA_ROTACION_MS = 10_000;
/** Vida máxima de una sesión desde el ingreso, aunque se siga renovando. */
export const VIDA_MAXIMA_MS = 30 * 24 * 3600_000;
const RUTA_REFRESH = '/api/auth';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const opcionesCookie = (deps: Deps) =>
  ({ httpOnly: true, sameSite: 'lax', secure: deps.config.cookieSecure }) as const;

async function ponerAcceso(deps: Deps, reply: FastifyReply, u: UsuarioActual, familia: string) {
  const token = await firmarSesion(u, deps.config.SESSION_SECRET, DURACION_SESION_SEG, familia);
  reply.setCookie(COOKIE_SESION, token, { ...opcionesCookie(deps), path: '/', maxAge: DURACION_SESION_SEG });
}

async function nuevoRefresh(db: Ejecutor, req: FastifyRequest, usuarioId: string, familia: string, creadoAt?: Date) {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sesiones).values({
    usuarioId,
    familia,
    tokenHash: hashToken(token),
    creadoAt,
    expiraAt: new Date(Date.now() + DURACION_REFRESH_SEG * 1000),
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300),
  });
  return token;
}

const ponerRefresh = (deps: Deps, reply: FastifyReply, token: string) =>
  reply.setCookie(COOKIE_REFRESH, token, {
    ...opcionesCookie(deps),
    path: RUTA_REFRESH,
    maxAge: DURACION_REFRESH_SEG,
  });

export function borrarCookies(deps: Deps, reply: FastifyReply) {
  reply.clearCookie(COOKIE_SESION, { ...opcionesCookie(deps), path: '/' });
  reply.clearCookie(COOKIE_REFRESH, { ...opcionesCookie(deps), path: RUTA_REFRESH });
}

/** Abre una familia nueva y deja las dos cookies. null si el usuario no está activo. */
export async function abrirSesion(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  usuarioId: string,
): Promise<UsuarioActual | null> {
  const u = await obtenerUsuarioSesion(deps.conexion.db, usuarioId);
  if (!u) return null;
  // La sesión que hubiera en este navegador deja de valer.
  await cerrarSesionActual(deps, req);
  const familia = randomUUID();
  ponerRefresh(deps, reply, await nuevoRefresh(deps.conexion.db, req, u.id, familia));
  await ponerAcceso(deps, reply, u, familia);
  return u;
}

/**
 * Primero bloquea las filas: si hay una rotación en curso se la espera, y la actualización posterior ya ve
 * el token que haya creado.
 */
const revocarFamilia = (db: Ejecutor, familia: string) =>
  db.transaction(async (tx) => {
    await tx.select({ id: sesiones.id }).from(sesiones).where(eq(sesiones.familia, familia)).for('update');
    await tx
      .update(sesiones)
      .set({ revocadoAt: new Date() })
      .where(and(eq(sesiones.familia, familia), isNull(sesiones.revocadoAt)));
  });

/**
 * Rota el refresh. Un token ya usado fuera de la ventana de gracia revoca toda la familia; dentro de ella
 * solo se entrega un acceso nuevo (el refresh vigente ya lo puso la respuesta que ganó la carrera).
 */
export async function renovarSesion(deps: Deps, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE_REFRESH];
  if (!token) return null;
  const r = await deps.conexion.db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(sesiones)
      .where(eq(sesiones.tokenHash, hashToken(token)))
      .for('update');
    const ahora = Date.now();
    if (!s || s.revocadoAt || s.expiraAt.getTime() <= ahora) return null;
    const enGracia = s.usadoAt !== null && ahora - s.usadoAt.getTime() <= GRACIA_ROTACION_MS;
    const [inicio] = await tx
      .select({ desde: sql<Date>`min(${sesiones.creadoAt})`.mapWith(sesiones.creadoAt) })
      .from(sesiones)
      .where(eq(sesiones.familia, s.familia));
    const usuario = await obtenerUsuarioSesion(tx, s.usuarioId);
    // Reuso, sesión demasiado vieja o usuario inactivo: se revoca la familia (la transacción confirma).
    if ((s.usadoAt && !enGracia) || !usuario || ahora - inicio!.desde.getTime() > VIDA_MAXIMA_MS) {
      await revocarFamilia(tx, s.familia);
      return null;
    }
    if (enGracia) return { usuario, familia: s.familia, nuevo: null };
    await tx.update(sesiones).set({ usadoAt: new Date() }).where(eq(sesiones.id, s.id));
    return { usuario, familia: s.familia, nuevo: await nuevoRefresh(tx, req, s.usuarioId, s.familia) };
  });
  if (!r) return null;
  if (r.nuevo) ponerRefresh(deps, reply, r.nuevo);
  await ponerAcceso(deps, reply, r.usuario, r.familia);
  return r.usuario;
}

/** Revoca la sesión que traigan las cookies (refresh o acceso). */
export async function cerrarSesionActual(deps: Deps, req: FastifyRequest): Promise<void> {
  const { db } = deps.conexion;
  const familias = new Set<string>();
  const refresh = req.cookies[COOKIE_REFRESH];
  if (refresh) {
    const [s] = await db
      .select({ familia: sesiones.familia })
      .from(sesiones)
      .where(eq(sesiones.tokenHash, hashToken(refresh)));
    if (s) familias.add(s.familia);
  }
  const acceso = req.cookies[COOKIE_SESION];
  const t = acceso ? await verificarSesion(acceso, deps.config.SESSION_SECRET) : null;
  if (t?.familia) familias.add(t.familia);
  for (const f of familias) await revocarFamilia(db, f);
}
