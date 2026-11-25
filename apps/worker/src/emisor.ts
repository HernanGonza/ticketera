/**
 * Emisor hacia los servidores Socket.IO a través de Postgres, en el formato de
 * `@socket.io/postgres-adapter` 0.5 (el de `socket.io-adapter` 2.5).
 * `@socket.io/postgres-emitter` 0.1.1 no sirve: omite `nsp` y el adapter descarta sus mensajes.
 *
 * Publica sobre el ejecutor recibido: si es una transacción, los avisos salen recién al confirmarla.
 */
import { encode } from '@msgpack/msgpack';
import { sql } from 'drizzle-orm';
import type { Ejecutor } from '@eco/api/db';
import type { EventosServidor } from '@eco/shared/realtime';

const CANAL = 'socket.io#/';
const NSP = '/';
const TABLA_ADJUNTOS = 'socket_io_attachments';
/** El mismo número que usa la API al crear la tabla. */
const BLOQUEO_TABLA_ADJUNTOS = 7_316_101;
/** Límite de `NOTIFY` (8000 bytes) con margen. */
const MAX_NOTIFY = 7900;
/** Debe coincidir con `EVENTO_REEVALUAR` de la API. */
export const EVENTO_REEVALUAR = 'eco:reevaluar';

const TIPO = { difundir: 3, desconectar: 6, entreServidores: 9 } as const;

export async function asegurarTablaAdjuntos(db: Ejecutor): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BLOQUEO_TABLA_ADJUNTOS})`);
    await tx.execute(
      sql.raw(`create table if not exists ${TABLA_ADJUNTOS} (
        id bigserial unique, created_at timestamptz default now(), payload bytea)`),
    );
  });
}

export function crearEmisor(db: Ejecutor) {
  async function publicar(tipo: number, data: unknown): Promise<void> {
    const mensaje = { uid: 'emitter', nsp: NSP, type: tipo, data };
    let texto = JSON.stringify(mensaje);
    if (Buffer.byteLength(texto) > MAX_NOTIFY) {
      const cuerpo = Buffer.from(encode(JSON.parse(texto)));
      const r = await db.execute<{ id: string }>(
        sql`insert into socket_io_attachments (payload) values (${cuerpo}) returning id`,
      );
      texto = JSON.stringify({ uid: mensaje.uid, nsp: NSP, type: tipo, attachmentId: r.rows[0]!.id });
    }
    await db.execute(sql`select pg_notify(${CANAL}, ${texto})`);
  }
  const opciones = (salas: string[]) => ({ rooms: salas, except: [], flags: {} });

  return {
    /** Un socket presente en varias de las salas recibe el evento una sola vez. */
    emitir<E extends keyof EventosServidor>(
      salas: string | string[],
      evento: E,
      payload: Parameters<EventosServidor[E]>[0],
    ): Promise<void> {
      const destino = [...new Set([salas].flat())];
      // Sin salas se enviaría a todos.
      if (!destino.length) return Promise.resolve();
      return publicar(TIPO.difundir, {
        packet: { type: 2, data: [evento, payload], nsp: NSP },
        opts: opciones(destino),
      });
    },
    /** Desconecta en todas las réplicas a los sockets de esas salas. */
    desconectar(sala: string): Promise<void> {
      return publicar(TIPO.desconectar, { opts: opciones([sala]), close: true });
    },
    entreServidores(evento: string): Promise<void> {
      return publicar(TIPO.entreServidores, { packet: [evento] });
    },
  };
}
export type Emisor = ReturnType<typeof crearEmisor>;
