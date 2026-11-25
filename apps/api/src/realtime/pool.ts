/** Conexiones propias del adapter de Socket.IO y su tabla de adjuntos. */
import pg from 'pg';

export const TABLA_ADJUNTOS = 'socket_io_attachments';
/** Advisory lock para crear la tabla sin carreras (el worker usa el mismo número). */
export const BLOQUEO_TABLA_ADJUNTOS = 7_316_101;

/**
 * Tabla donde viajan los mensajes del cluster que superan los 8000 bytes de `NOTIFY`.
 * Idempotente y segura entre procesos concurrentes.
 */
export async function asegurarTablaAdjuntos(pool: pg.Pool): Promise<void> {
  // Varias sentencias en una sola consulta = una transacción implícita: el lock se libera al terminar.
  await pool.query(`
    select pg_advisory_xact_lock(${BLOQUEO_TABLA_ADJUNTOS});
    create table if not exists ${TABLA_ADJUNTOS} (
      id bigserial unique,
      created_at timestamptz default now(),
      payload bytea
    );`);
}

/**
 * Pool exclusivo para el adapter (mantiene una conexión en `LISTEN`).
 * El adapter no atiende los errores de esa conexión ni la devuelve al cortarse: se hace acá para que
 * una caída de la base no tire el proceso ni agote el pool.
 */
export function crearPoolAdapter(url: string, alFallar: (error: Error) => void): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  pool.on('error', alFallar);
  pool.on('connect', (cliente) => {
    cliente.on('error', alFallar);
    cliente.once('end', () =>
      setImmediate(() => {
        try {
          cliente.release(true);
        } catch {
          // Ya estaba devuelta.
        }
      }),
    );
  });
  return pool;
}
