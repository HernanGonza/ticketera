/** Arranque y apagado del worker: pg-boss, consumidores, crones y publicador del outbox. */
import { setTimeout as esperar } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import type { Config } from '@eco/api/config';
import { autoasignar, autocerrarVencidos, limpiar, revisarSla, type Conexion } from '@eco/api/db';
import { COLAS, type NombreCola, type TrabajoAsignacion, type TrabajoMail } from '@eco/shared/colas';
import { crearColas, programarCrones } from './colas';
import { asegurarTablaAdjuntos } from './emisor';
import { procesarTrabajoMail } from './mail/manejador';
import { crearTransporte, type Transporte } from './mail/transporte';
import { crearPublicador, type OpcionesPublicador } from './publicador';

export interface OpcionesWorker extends OpcionesPublicador {
  /** false: no registra ni ejecuta los crones (pruebas). */
  crones?: boolean;
  sondeoSeg?: number;
  transporte?: Transporte;
}

/** Espera a que la API haya aplicado las migraciones. Devuelve false si se canceló. */
export async function esperarEsquema(
  conexion: Conexion,
  log: Logger,
  cancelado: AbortSignal,
  intervaloMs = 2000,
): Promise<boolean> {
  for (let intento = 0; !cancelado.aborted; intento++) {
    try {
      // La última columna agregada por las migraciones que usa el worker.
      await conexion.db.execute(sql`select o.id, u.bloqueado from outbox_eventos o, usuarios u limit 0`);
      return true;
    } catch (e) {
      if (intento % 15 === 0)
        log.warn(
          { codigo: (e as { cause?: { code?: string }; code?: string }).cause?.code },
          'La base todavía no está lista (¿migraciones pendientes?); reintentando',
        );
      await esperar(intervaloMs, undefined, { signal: cancelado }).catch(() => {});
    }
  }
  return false;
}

/**
 * Los errores quedan guardados en la tabla de trabajos y en los registros: solo un mensaje breve, sin
 * consultas ni parámetros (los errores de la capa de datos los incluyen).
 */
function errorSeguro(e: unknown): Error {
  const x = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
  const mensaje = x.cause?.message ?? x.message ?? 'Error desconocido';
  const codigo = x.cause?.code ?? x.code;
  const limpio = new Error(
    `${codigo ? `[${codigo}] ` : ''}${mensaje.split('\n')[0]!.replace(/token=[\w-]+/gi, 'token=[oculto]')}`.slice(0, 300),
  );
  limpio.stack = undefined;
  return limpio;
}

export async function iniciarWorker(
  deps: { config: Config; conexion: Conexion; log: Logger },
  opciones: OpcionesWorker = {},
) {
  const { config, conexion, log } = deps;
  const { db } = conexion;
  await asegurarTablaAdjuntos(db);

  const conCrones = opciones.crones ?? true;
  const boss = new PgBoss({ connectionString: config.DATABASE_URL, max: 4, schedule: conCrones });
  boss.on('error', (err) => log.error({ err }, 'Error de pg-boss'));
  boss.on('warning', (w) => log.warn({ aviso: w.message }, 'Aviso de pg-boss'));
  await boss.start();
  await crearColas(boss);

  const transporte = opciones.transporte ?? crearTransporte(config, log);
  const publicador = crearPublicador({ conexion, boss, log, url: config.DATABASE_URL }, opciones);
  const sondeo = opciones.sondeoSeg;

  async function consumir<T extends object>(
    cola: NombreCola,
    ejecutar: (datos: T) => Promise<object>,
    ajustes: { pollingIntervalSeconds: number; localConcurrency?: number },
  ) {
    await boss.work<T>(
      cola,
      { ...ajustes, ...(sondeo ? { pollingIntervalSeconds: sondeo } : {}) },
      async ([trabajo]) => {
        if (!trabajo) return;
        try {
          return await ejecutar(trabajo.data);
        } catch (e) {
          const limpio = errorSeguro(e);
          log.warn({ cola, trabajoId: trabajo.id, err: limpio }, 'Falló un trabajo');
          throw limpio;
        }
      },
    );
  }

  await consumir<TrabajoMail>(
    COLAS.mail,
    async (datos) => {
      const resultado = await procesarTrabajoMail({ db, transporte, appUrl: config.appUrl }, datos);
      log.info({ clase: datos.clase, resultado }, 'Correo procesado');
      return { resultado };
    },
    { pollingIntervalSeconds: 2, localConcurrency: 2 },
  );
  await consumir<TrabajoAsignacion>(
    COLAS.asignacion,
    async ({ ticketId }) => ({ asignado: await autoasignar(db, ticketId) }),
    { pollingIntervalSeconds: 0.5 },
  );
  await consumir(COLAS.sla, async () => ({ alertas: (await revisarSla(db)).length }), { pollingIntervalSeconds: 5 });
  await consumir(COLAS.autocierre, async () => ({ cerrados: (await autocerrarVencidos(db)).length }), {
    pollingIntervalSeconds: 10,
  });
  await consumir(
    COLAS.limpieza,
    async () => {
      await limpiar(db);
      return { ok: true };
    },
    { pollingIntervalSeconds: 30 },
  );
  // El publicador corre en continuo; el cron es una pasada de seguridad y deja constancia en el panel.
  await consumir(
    COLAS.outbox,
    async () => {
      await publicador.despertar();
      return { ok: true };
    },
    { pollingIntervalSeconds: 10 },
  );

  await publicador.iniciar();
  if (conCrones) await programarCrones(boss);

  let detenido: Promise<void> | undefined;
  return {
    boss,
    publicador,
    /** Termina lo que está en curso y libera las conexiones propias (no `deps.conexion`). */
    detener: () =>
      (detenido ??= (async () => {
        await publicador.detener();
        await boss.stop({ graceful: true, timeout: 10_000, close: true });
        transporte.cerrar();
      })()),
  };
}
export type Worker = Awaited<ReturnType<typeof iniciarWorker>>;
