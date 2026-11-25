/** Tareas del worker: publicación del outbox, alertas de SLA, autocierre y limpieza. */
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { estadoSla, type Calendario } from '@eco/shared/dominio';
import { BLOQUEO } from './bloqueos';
import type { Ejecutor, Tx } from './conexion';
import { leerConfiguracion } from './configuracion';
import { emitirEvento } from './eventos';
import { actualizarTicket, registrarEvento } from './operaciones-tickets';
import {
  outboxEventos,
  portalJti,
  recuperacionesPassword,
  sesiones,
  tickets,
  type AlertaSla,
  type OutboxFila,
  type TicketFila,
} from './schema';

const MAX_INTENTOS_OUTBOX = 10;

/**
 * Toma eventos pendientes en orden (`for update skip locked`, apto para varios procesos), llama a `manejar`
 * y marca `publicado_at`. Si falla, registra el error y reintenta luego; al décimo intento lo descarta.
 * Devuelve la cantidad publicada.
 */
export async function procesarOutbox(
  db: Ejecutor,
  manejar: (evento: OutboxFila) => Promise<void>,
  limite = 100,
): Promise<number> {
  return db.transaction(async (tx) => {
    const filas = await tx
      .select()
      .from(outboxEventos)
      .where(isNull(outboxEventos.publicadoAt))
      .orderBy(asc(outboxEventos.id))
      .limit(limite)
      .for('update', { skipLocked: true });
    const publicados: number[] = [];
    for (const f of filas) {
      try {
        await manejar(f);
        publicados.push(f.id);
      } catch (e) {
        const intentos = f.intentos + 1;
        await tx
          .update(outboxEventos)
          .set({
            intentos,
            ultimoError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
            publicadoAt: intentos >= MAX_INTENTOS_OUTBOX ? new Date() : null,
          })
          .where(eq(outboxEventos.id, f.id));
      }
    }
    if (publicados.length)
      await tx.update(outboxEventos).set({ publicadoAt: new Date() }).where(inArray(outboxEventos.id, publicados));
    return publicados.length;
  });
}

export interface AlertaEmitida {
  ticketId: string;
  nivel: 'por_vencer' | 'vencido';
  clase: 'respuesta' | 'resolucion';
}

type DatosAlerta = Pick<
  TicketFila,
  | 'estado'
  | 'creadoAt'
  | 'enEsperaDesde'
  | 'primeraRespuestaAt'
  | 'venceRespuestaAt'
  | 'venceResolucionAt'
  | 'slaRespuestaMin'
  | 'slaResolucionMin'
  | 'alertasSla'
>;

/** Alertas que corresponden y todavía no se emitieron. En espera o cerrado no genera ninguna. */
export function alertasPendientes(t: DatosAlerta, ahora: Date, cal: Calendario): Omit<AlertaEmitida, 'ticketId'>[] {
  if (t.estado !== 'nuevo' && t.estado !== 'asignado' && t.estado !== 'en_curso') return [];
  const clases = [
    ['respuesta', t.venceRespuestaAt, t.slaRespuestaMin, t.primeraRespuestaAt],
    ['resolucion', t.venceResolucionAt, t.slaResolucionMin, null],
  ] as const;
  return clases.flatMap(([clase, venceAt, totalMin, cumplidoAt]) => {
    if (cumplidoAt) return [];
    const { semaforo } = estadoSla(
      { creadoAt: t.creadoAt, venceAt, totalMin, enEsperaDesde: null, cumplidoAt: null },
      ahora,
      cal,
    );
    if (semaforo !== 'vencido' && semaforo !== 'por_vencer') return [];
    return t.alertasSla.includes(`${clase}:${semaforo}`) ? [] : [{ nivel: semaforo, clase }];
  });
}

async function emitirAlerta(tx: Tx, ticketId: string, a: Omit<AlertaEmitida, 'ticketId'>, ahora: Date) {
  const nuevas: AlertaSla[] = [`${a.clase}:${a.nivel}`];
  // Un vencido deja sin sentido el aviso previo.
  if (a.nivel === 'vencido') nuevas.push(`${a.clase}:por_vencer`);
  await tx
    .update(tickets)
    .set({
      alertasSla: sql`array(select distinct unnest(${tickets.alertasSla} || ${sql.param(nuevas)}::text[]))`,
    })
    .where(eq(tickets.id, ticketId));
  await registrarEvento(tx, ticketId, `sla_${a.nivel}`, null, a.clase, null, ahora);
  await emitirEvento(tx, 'sla.alerta', { ticketId, nivel: a.nivel, clase: a.clase });
}

/** Detecta SLA al 80 % o vencidos y emite cada alerta una sola vez. */
export async function revisarSla(db: Ejecutor, ahora: Date = new Date()): Promise<AlertaEmitida[]> {
  const { calendario } = await leerConfiguracion(db);
  const candidatos = await db
    .select()
    .from(tickets)
    .where(inArray(tickets.estado, ['nuevo', 'asignado', 'en_curso']));
  const emitidas: AlertaEmitida[] = [];
  for (const c of candidatos) {
    if (!alertasPendientes(c, ahora, calendario).length) continue;
    await db.transaction(async (tx) => {
      const [t] = await tx.select().from(tickets).where(eq(tickets.id, c.id)).for('update');
      if (!t) return;
      for (const a of alertasPendientes(t, ahora, calendario)) {
        await emitirAlerta(tx, t.id, a, ahora);
        emitidas.push({ ticketId: t.id, ...a });
      }
    });
  }
  return emitidas;
}

/** Cierra un ticket resuelto cuyo plazo venció. Devuelve true si lo cerró. */
export async function autocerrar(db: Ejecutor, ticketId: string, ahora: Date = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BLOQUEO.kanban})`);
    const [t] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.estado, 'resuelto'), lte(tickets.autocierreAt, ahora)))
      .for('update');
    if (!t) return false;
    await actualizarTicket(tx, t.id, { estado: 'cerrado' }, null, { ahora });
    return true;
  });
}

/** Cierra todos los resueltos con el plazo cumplido. Devuelve sus ids. */
export async function autocerrarVencidos(db: Ejecutor, ahora: Date = new Date()): Promise<string[]> {
  const pendientes = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.estado, 'resuelto'), lte(tickets.autocierreAt, ahora)))
    .orderBy(asc(tickets.autocierreAt));
  const cerrados: string[] = [];
  for (const { id } of pendientes) if (await autocerrar(db, id, ahora)) cerrados.push(id);
  return cerrados;
}

/** Borra sesiones y `jti` vencidos, recuperaciones viejas y eventos publicados hace más de 7 días. */
export async function limpiar(db: Ejecutor, ahora: Date = new Date()): Promise<void> {
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 86_400_000);
  await db.delete(sesiones).where(lte(sesiones.expiraAt, ahora));
  await db.delete(portalJti).where(lte(portalJti.expiraAt, ahora));
  await db.delete(recuperacionesPassword).where(lte(recuperacionesPassword.expiraAt, hace(1)));
  await db.delete(outboxEventos).where(lte(outboxEventos.publicadoAt, hace(7)));
}
