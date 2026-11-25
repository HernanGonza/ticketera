import { sql } from 'drizzle-orm';
import { CANAL_OUTBOX, type EventosDominio, type TipoEventoDominio } from '@eco/shared/eventos';
import type { Tx } from './conexion';
import { outboxEventos } from './schema';

/**
 * Escribe un evento de dominio en el outbox dentro de la transacción en curso y avisa al publicador.
 * El NOTIFY se entrega recién al confirmar la transacción.
 */
export async function emitirEvento<T extends TipoEventoDominio>(
  tx: Tx,
  tipo: T,
  payload: EventosDominio[T],
): Promise<void> {
  await tx.insert(outboxEventos).values({ tipo, payload: { ...payload } });
  await tx.execute(sql`select pg_notify(${CANAL_OUTBOX}, ${tipo})`);
}
