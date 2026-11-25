/** Mensajes, adjuntos, lecturas y notificaciones. Ninguna de estas operaciones incrementa `version`. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  esStaff,
  minutosHabilesEntre,
  puedeVerTicket,
  type TipoNotificacion,
  type UsuarioSesion,
} from '@eco/shared/dominio';
import type { Notificacion } from '@eco/shared/schemas';
import { ErrorHttp, noEncontrado, sinPermiso } from '../errores';
import type { Ejecutor, Tx } from './conexion';
import { leerConfiguracion } from './configuracion';
import { aNotificacion, esUuid } from './consultas';
import { emitirEvento } from './eventos';
import { bloquearTicket, exigirEscritura, registrarEvento } from './operaciones-tickets';
import { adjuntos, lecturas, mensajes, notificaciones, tickets } from './schema';

/** Avanza la marca de lectura (nunca retrocede). Devuelve true si cambió. */
async function avanzarLectura(
  tx: Tx,
  ticketId: string,
  usuarioId: string,
  mensaje: { id: string; creadoAt: Date },
  ahora: Date,
): Promise<boolean> {
  const filas = await tx
    .insert(lecturas)
    .values({
      ticketId,
      usuarioId,
      ultimoMensajeId: mensaje.id,
      ultimoMensajeAt: mensaje.creadoAt,
      leidoAt: ahora,
    })
    .onConflictDoUpdate({
      target: [lecturas.usuarioId, lecturas.ticketId],
      set: { ultimoMensajeId: mensaje.id, ultimoMensajeAt: mensaje.creadoAt, leidoAt: ahora },
      setWhere: sql`${lecturas.ultimoMensajeAt} < excluded.ultimo_mensaje_at`,
    })
    .returning({ ticketId: lecturas.ticketId });
  return filas.length > 0;
}

export interface DatosNuevoMensaje {
  ticketId: string;
  cuerpo: string;
  interno?: boolean;
  clienteId?: string | null;
}

/**
 * Publica un mensaje. Idempotente por (ticket, autor, clienteId): un reintento devuelve el id original
 * con `creado: false`. La primera respuesta es el primer mensaje público de staff que no sea el solicitante.
 */
export async function crearMensaje(
  db: Ejecutor,
  datos: DatosNuevoMensaje,
  autor: UsuarioSesion,
  ahora?: Date,
): Promise<{ id: string; creado: boolean }> {
  return db.transaction(async (tx) => {
    // El bloqueo de la fila serializa reintentos y mensajes simultáneos del mismo ticket.
    const t = await bloquearTicket(tx, datos.ticketId);
    await exigirEscritura(tx, t, autor);
    const interno = datos.interno ?? false;
    if (interno && !esStaff(autor)) throw sinPermiso();
    const cuerpo = datos.cuerpo.trim();
    if (!cuerpo) throw new ErrorHttp(400, 'validacion', 'Escriba un mensaje.');
    const clienteId = datos.clienteId || null;
    if (clienteId) {
      const [previo] = await tx
        .select({ id: mensajes.id })
        .from(mensajes)
        .where(
          and(eq(mensajes.ticketId, t.id), eq(mensajes.autorId, autor.id), eq(mensajes.clienteId, clienteId)),
        );
      if (previo) return { id: previo.id, creado: false };
    }
    const fecha = ahora ?? new Date();
    const [m] = await tx
      .insert(mensajes)
      .values({ ticketId: t.id, autorId: autor.id, cuerpo, interno, clienteId, creadoAt: fecha })
      .returning({ id: mensajes.id, creadoAt: mensajes.creadoAt });
    await avanzarLectura(tx, t.id, autor.id, m!, fecha);

    const primera = !interno && esStaff(autor) && autor.id !== t.solicitanteId && !t.primeraRespuestaAt;
    if (!interno) {
      const parche: Partial<typeof tickets.$inferInsert> = { actualizadoAt: fecha };
      if (primera) {
        const { calendario } = await leerConfiguracion(tx);
        const detenido =
          t.minutosEnEspera + (t.enEsperaDesde ? minutosHabilesEntre(t.enEsperaDesde, fecha, calendario) : 0);
        parche.primeraRespuestaAt = fecha;
        parche.minPrimeraRespuesta = Math.max(0, minutosHabilesEntre(t.creadoAt, fecha, calendario) - detenido);
      }
      await tx.update(tickets).set(parche).where(eq(tickets.id, t.id));
    }
    await emitirEvento(tx, 'mensaje.creado', { ticketId: t.id, mensajeId: m!.id, actorId: autor.id, interno });
    if (primera) {
      await registrarEvento(tx, t.id, 'primera_respuesta', null, null, autor.id, fecha);
      await emitirEvento(tx, 'ticket.actualizado', {
        ticketId: t.id,
        actorId: autor.id,
        cambios: { primeraRespuesta: true },
      });
    }
    return { id: m!.id, creado: true };
  });
}

/** Mensaje junto con su ticket, comprobando que el actor lo pueda ver. */
async function mensajeVisible(tx: Tx, mensajeId: string, actor: UsuarioSesion) {
  if (!esUuid(mensajeId)) throw noEncontrado('El mensaje');
  const [f] = await tx
    .select({ m: mensajes, solicitanteId: tickets.solicitanteId, areaId: tickets.areaId })
    .from(mensajes)
    .innerJoin(tickets, eq(tickets.id, mensajes.ticketId))
    .where(eq(mensajes.id, mensajeId))
    .for('update', { of: mensajes });
  if (!f) throw noEncontrado('El mensaje');
  const { solicitanteVeArea } = await leerConfiguracion(tx);
  if (!puedeVerTicket(actor, f, { solicitanteVeArea }) || (f.m.interno && !esStaff(actor)))
    throw noEncontrado('El mensaje');
  return f;
}

/** Solo el autor. `cambiado: false` si el texto es el mismo. */
export async function editarMensaje(
  db: Ejecutor,
  mensajeId: string,
  cuerpo: string,
  actor: UsuarioSesion,
  ahora?: Date,
): Promise<{ ticketId: string; interno: boolean; cambiado: boolean }> {
  return db.transaction(async (tx) => {
    const f = await mensajeVisible(tx, mensajeId, actor);
    if (f.m.autorId !== actor.id) throw sinPermiso();
    await exigirEscritura(tx, f, actor);
    const texto = cuerpo.trim();
    if (!texto) throw new ErrorHttp(400, 'validacion', 'Escriba un mensaje.');
    const { ticketId, interno } = f.m;
    if (texto === f.m.cuerpo) return { ticketId, interno, cambiado: false };
    await tx
      .update(mensajes)
      .set({ cuerpo: texto, editadoAt: ahora ?? new Date() })
      .where(eq(mensajes.id, mensajeId));
    await emitirEvento(tx, 'mensaje.editado', { ticketId, mensajeId, actorId: actor.id, interno });
    return { ticketId, interno, cambiado: true };
  });
}

export interface DatosNuevoAdjunto {
  ticketId: string;
  mensajeId?: string | null;
  /** Ruta relativa a UPLOADS_DIR. */
  ruta: string;
  nombre: string;
  mime: string;
  bytes: number;
}

/**
 * Registra un archivo ya guardado en disco (el MIME y el tamaño los valida quien llama).
 * Con `mensajeId`, solo el autor del mensaje, y el adjunto hereda su visibilidad. Devuelve el id.
 */
export async function registrarAdjunto(
  db: Ejecutor,
  datos: DatosNuevoAdjunto,
  actor: UsuarioSesion,
  ahora?: Date,
): Promise<string> {
  return db.transaction(async (tx) => {
    const t = await bloquearTicket(tx, datos.ticketId);
    await exigirEscritura(tx, t, actor);
    let interno = false;
    if (datos.mensajeId) {
      const f = await mensajeVisible(tx, datos.mensajeId, actor);
      if (f.m.ticketId !== t.id) throw noEncontrado('El mensaje');
      if (f.m.autorId !== actor.id) throw sinPermiso();
      interno = f.m.interno;
    }
    const fecha = ahora ?? new Date();
    const [a] = await tx
      .insert(adjuntos)
      .values({ ...datos, mensajeId: datos.mensajeId ?? null, interno, subidoPorId: actor.id, creadoAt: fecha })
      .returning({ id: adjuntos.id });
    if (!interno) await tx.update(tickets).set({ actualizadoAt: fecha }).where(eq(tickets.id, t.id));
    await emitirEvento(tx, 'adjunto.creado', { ticketId: t.id, adjuntoId: a!.id, actorId: actor.id, interno });
    return a!.id;
  });
}

/** Marca leído hasta ese mensaje (no retrocede). Devuelve true si avanzó. El acceso al ticket se valida aquí. */
export async function marcarLeido(
  db: Ejecutor,
  ticketId: string,
  usuario: UsuarioSesion,
  ultimoMensajeId: string,
  ahora?: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const f = await mensajeVisible(tx, ultimoMensajeId, usuario);
    if (f.m.ticketId !== ticketId) throw noEncontrado('El mensaje');
    const avanzo = await avanzarLectura(tx, ticketId, usuario.id, f.m, ahora ?? new Date());
    if (avanzo) await emitirEvento(tx, 'lectura.actualizada', { ticketId, usuarioId: usuario.id });
    return avanzo;
  });
}

export interface NuevaNotificacion {
  usuarioId: string;
  tipo: TipoNotificacion;
  payload: Notificacion['payload'];
}

/** Inserta notificaciones y devuelve sus DTO (para emitir `notificacion:nueva`). */
export async function crearNotificaciones(
  db: Ejecutor,
  nuevas: readonly NuevaNotificacion[],
  ahora?: Date,
): Promise<{ usuarioId: string; notificacion: Notificacion }[]> {
  if (!nuevas.length) return [];
  return db.transaction(async (tx) => {
    const creadaAt = ahora ?? new Date();
    const filas = await tx
      .insert(notificaciones)
      .values(nuevas.map((n) => ({ ...n, creadaAt })))
      .returning();
    for (const usuarioId of new Set(filas.map((f) => f.usuarioId)))
      await emitirEvento(tx, 'notificaciones.actualizadas', { usuarioId });
    return filas.map((f) => ({ usuarioId: f.usuarioId, notificacion: aNotificacion(f) }));
  });
}

/** Marca como leídas las propias (todas si no se indican ids). Devuelve cuántas cambiaron. */
export async function marcarNotificaciones(db: Ejecutor, usuarioId: string, ids?: number[]): Promise<number> {
  if (ids && !ids.length) return 0;
  return db.transaction(async (tx) => {
    const filas = await tx
      .update(notificaciones)
      .set({ leida: true })
      .where(
        and(
          eq(notificaciones.usuarioId, usuarioId),
          sql`not ${notificaciones.leida}`,
          ids ? inArray(notificaciones.id, ids) : undefined,
        ),
      )
      .returning({ id: notificaciones.id });
    if (filas.length) await emitirEvento(tx, 'notificaciones.actualizadas', { usuarioId });
    return filas.length;
  });
}
