/**
 * Publicador del outbox: despierta con LISTEN/NOTIFY y además revisa cada tanto. Procesa en orden y de a
 * un publicador por vez (advisory lock), así varias instancias del worker no se pisan.
 */
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { procesarOutbox, type Conexion } from '@eco/api/db';
import { CANAL_OUTBOX } from '@eco/shared/eventos';
import { SALAS } from '@eco/shared/realtime';
import { encolador } from './colas';
import { crearEmisor } from './emisor';
import { traducir } from './traductor';

export const BLOQUEO_PUBLICADOR = 7_316_102;
const LOTE = 50;

export interface OpcionesPublicador {
  /** Revisión de respaldo si se pierde un aviso. */
  intervaloMs?: number;
  debounceTableroMs?: number;
  agrupadoSeg?: number;
}

export function crearPublicador(
  deps: { conexion: Conexion; boss: PgBoss; log: Logger; url: string },
  opciones: OpcionesPublicador = {},
) {
  const { conexion, boss, log, url } = deps;
  const { db } = conexion;
  const error = (err: unknown, mensaje: string) => log.warn({ err }, mensaje);

  let activo = false;
  let enCurso: Promise<void> | null = null;
  let pendiente = false;

  // Tablero: espera una pausa breve, pero nunca más de cuatro veces ese margen.
  const debounce = opciones.debounceTableroMs ?? 500;
  let tableroTimer: NodeJS.Timeout | undefined;
  let tableroDesde = 0;
  const emitirTablero = async () => {
    clearTimeout(tableroTimer);
    tableroTimer = undefined;
    await crearEmisor(db)
      .emitir(SALAS.tablero, 'tablero:actualizar', {})
      .catch((e) => error(e, 'No se pudo avisar al tablero'));
  };
  const pedirTablero = () => {
    if (!tableroTimer) tableroDesde = Date.now();
    else if (Date.now() - tableroDesde >= debounce * 3) return;
    clearTimeout(tableroTimer);
    tableroTimer = setTimeout(() => void emitirTablero(), debounce);
  };

  /** Publica un lote. Devuelve cuántos eventos publicó. */
  async function lote(): Promise<number> {
    let tablero = false;
    const publicados = await db.transaction(async (tx) => {
      const r = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(${BLOQUEO_PUBLICADOR}) as ok`,
      );
      // Otro publicador está trabajando.
      if (!r.rows[0]?.ok) return 0;
      return procesarOutbox(
        tx,
        async (evento) => {
          // Savepoint propio: si falla, no queda ningún efecto a medias y el resto del lote sigue.
          await tx.execute(sql`savepoint evento`);
          try {
            await traducir(evento, {
              tx,
              emisor: crearEmisor(tx),
              cola: encolador(boss, tx),
              tablero: () => (tablero = true),
              clave: `outbox:${evento.id}`,
              agrupadoSeg: opciones.agrupadoSeg,
            });
            await tx.execute(sql`release savepoint evento`);
          } catch (e) {
            await tx.execute(sql`rollback to savepoint evento`);
            await tx.execute(sql`release savepoint evento`);
            log.error({ eventoId: evento.id, tipo: evento.tipo, err: e }, 'No se pudo publicar el evento; se reintentará');
            throw e;
          }
        },
        LOTE,
      );
    });
    if (tablero) pedirTablero();
    return publicados;
  }

  /** Vacía el outbox. Las llamadas simultáneas se funden en una. */
  function despertar(): Promise<void> {
    pendiente = true;
    enCurso ??= (async () => {
      try {
        while (pendiente && activo) {
          pendiente = false;
          if ((await lote()) === LOTE) pendiente = true;
        }
      } catch (e) {
        pendiente = false;
        error(e, 'Falló la publicación del outbox; se reintentará');
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  }

  let escucha: pg.Client | undefined;
  let reconexion: NodeJS.Timeout | undefined;
  async function escuchar(): Promise<void> {
    if (!activo) return;
    const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
    let caido = false;
    const caer = (e?: Error) => {
      if (caido) return;
      caido = true;
      if (escucha === cliente) escucha = undefined;
      void cliente.end().catch(() => {});
      if (!activo) return;
      if (e) error(e, 'Se cortó la escucha del outbox; reconectando');
      reconexion = setTimeout(() => void escuchar(), 2000);
    };
    cliente.on('error', caer);
    cliente.on('end', () => caer(new Error('Conexión cerrada')));
    cliente.on('notification', () => void despertar());
    try {
      await cliente.connect();
      await cliente.query(`listen ${CANAL_OUTBOX}`);
      if (!activo) return void (await cliente.end());
      escucha = cliente;
      // Lo escrito mientras no se escuchaba.
      void despertar();
    } catch (e) {
      caer(e as Error);
    }
  }

  let respaldo: NodeJS.Timeout | undefined;
  return {
    async iniciar() {
      activo = true;
      respaldo = setInterval(() => void despertar(), opciones.intervaloMs ?? 1500);
      await escuchar();
    },
    despertar,
    async detener() {
      activo = false;
      clearInterval(respaldo);
      clearTimeout(reconexion);
      await enCurso;
      if (tableroTimer) await emitirTablero();
      await escucha?.end().catch(() => {});
    },
  };
}
export type Publicador = ReturnType<typeof crearPublicador>;
