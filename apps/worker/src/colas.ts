/** Definición de las colas de pg-boss y envío idempotente de trabajos. */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss, type Queue } from 'pg-boss';
import type { Tx } from '@eco/api/db';
import { COLAS, type NombreCola, type TrabajoAsignacion, type TrabajoMail } from '@eco/shared/colas';
import { ZONA_HORARIA } from '@eco/shared/marca';

const DIA = 86_400;

/**
 * No se usa cola de descarte aparte: los trabajos fallidos quedan 14 días en estado `failed`,
 * visibles en el panel y con opción de reintento.
 */
export const DEFINICIONES: Record<NombreCola, Omit<Queue, 'name'>> = {
  // `short`: un solo trabajo pendiente por `singletonKey` (agrupa los mensajes).
  [COLAS.mail]: {
    policy: 'short',
    retryLimit: 6,
    retryDelay: 15,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 120,
    retentionSeconds: 14 * DIA,
    deleteAfterSeconds: 14 * DIA,
  },
  [COLAS.asignacion]: {
    policy: 'standard',
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 60,
    deleteAfterSeconds: 7 * DIA,
  },
  [COLAS.sla]: { policy: 'short', retryLimit: 2, retryDelay: 10, expireInSeconds: 300, deleteAfterSeconds: 2 * DIA },
  [COLAS.autocierre]: {
    policy: 'short',
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 600,
    deleteAfterSeconds: 7 * DIA,
  },
  [COLAS.outbox]: { policy: 'short', retryLimit: 0, expireInSeconds: 60, deleteAfterSeconds: DIA },
  [COLAS.limpieza]: {
    policy: 'short',
    retryLimit: 3,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 900,
    deleteAfterSeconds: 14 * DIA,
  },
};

export const CRONES: readonly (readonly [NombreCola, string])[] = [
  [COLAS.sla, '* * * * *'],
  [COLAS.outbox, '* * * * *'],
  [COLAS.autocierre, '*/5 * * * *'],
  [COLAS.limpieza, '30 3 * * *'],
];

export async function crearColas(boss: PgBoss): Promise<void> {
  for (const [nombre, opciones] of Object.entries(DEFINICIONES)) await boss.createQueue(nombre, opciones);
}

export async function programarCrones(boss: PgBoss): Promise<void> {
  for (const [nombre, cron] of CRONES) await boss.schedule(nombre, cron, null, { tz: ZONA_HORARIA });
}

/** uuid derivado de una clave: reenviar el mismo trabajo no lo duplica. */
export function idDeterminista(clave: string): string {
  const h = createHash('sha256').update(clave).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Envio {
  /** Identifica el hecho que origina el trabajo (idempotencia). */
  clave: string;
  /** Mientras haya un trabajo pendiente con la misma, no se crea otro (solo colas `short`). */
  agrupar?: string;
  demoraSeg?: number;
}

/** Encola dentro de la transacción en curso: el trabajo existe solo si ella se confirma. */
export function encolador(boss: PgBoss, tx: Tx) {
  const enviar = (cola: NombreCola, datos: object, { clave, agrupar, demoraSeg }: Envio) =>
    boss.send(cola, datos, {
      id: idDeterminista(`${cola}|${clave}`),
      singletonKey: agrupar ?? clave,
      ...(demoraSeg ? { startAfter: demoraSeg } : {}),
      db: fromDrizzle(tx, sql),
    });
  return {
    mail: (trabajo: TrabajoMail, envio: Envio) => enviar(COLAS.mail, trabajo, envio),
    asignacion: (trabajo: TrabajoAsignacion, envio: Envio) => enviar(COLAS.asignacion, trabajo, envio),
  };
}
export type Encolador = ReturnType<typeof encolador>;
