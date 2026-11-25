/** `/api/admin/colas`: lectura directa de las tablas de pg-boss; reintentar y cancelar con su API. */
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { COLAS, type NombreCola } from '@eco/shared/colas';
import { zFiltroTrabajos, zOk, zResumenCola, zTrabajo, type ResumenCola, type Trabajo } from '@eco/shared/schemas';
import { exigirAdmin } from '../auth/guardas';
import { ErrorHttp, noEncontrado } from '../errores';
import { CON_SESION, respuestas } from '../rutas/comun';
import { depurar } from './depurar';

const NOMBRES: readonly string[] = Object.values(COLAS);
const zCola = z.object({ nombre: z.string().max(60).describe(`Una de: ${NOMBRES.join(', ')}`) });
const zColaTrabajo = zCola.extend({ id: z.uuid() });

function exigirCola(nombre: string): NombreCola {
  if (!NOMBRES.includes(nombre)) throw noEncontrado('La cola');
  return nombre as NombreCola;
}

interface FilaTrabajo extends Record<string, unknown> {
  id: string;
  name: string;
  state: Trabajo['estado'];
  data: unknown;
  output: unknown;
  retry_count: number;
  retry_limit: number;
  created_on: string | Date;
  started_on: string | Date | null;
  completed_on: string | Date | null;
}
const iso = (d: string | Date) => new Date(d).toISOString();

export const panel: FastifyPluginAsyncZod = async (app) => {
  const { conexion, config } = app.deps;
  const { db } = conexion;
  const base = { tags: ['colas'], security: CON_SESION };

  /** El esquema lo crea el worker la primera vez que arranca. */
  const hayEsquema = async () => {
    const r = await db.execute<{ ok: boolean }>(sql`select to_regclass('pgboss.job') is not null as ok`);
    return r.rows[0]?.ok === true;
  };

  /** Instancia mínima (sin mantenimiento ni crones), creada al primer uso. */
  let boss: Promise<PgBoss> | undefined;
  const conectarBoss = () =>
    (boss ??= (async () => {
      const b = new PgBoss({
        connectionString: config.DATABASE_URL,
        max: 2,
        supervise: false,
        schedule: false,
        migrate: false,
        createSchema: false,
        registerInstance: false,
      });
      b.on('error', (err) => app.log.warn({ err }, 'Error de pg-boss'));
      await b.start();
      return b;
    })().catch((e: unknown) => {
      boss = undefined;
      throw e;
    }));
  app.addHook('onClose', async () => {
    await (await boss?.catch(() => undefined))?.stop({ graceful: false, close: true });
  });

  app.get(
    '/api/admin/colas',
    {
      onRequest: exigirAdmin,
      schema: {
        ...base,
        summary: 'Resumen de trabajos por cola',
        response: respuestas(z.object({ items: z.array(zResumenCola) })),
      },
    },
    async () => {
      const filas = (await hayEsquema())
        ? (
            await db.execute<{ name: string; state: Trabajo['estado']; n: number }>(
              sql`select name, state::text as state, count(*)::int as n from pgboss.job group by name, state`,
            )
          ).rows
        : [];
      const items = NOMBRES.map((nombre): ResumenCola => {
        const n = (...estados: Trabajo['estado'][]) =>
          filas
            .filter((f) => f.name === nombre && estados.includes(f.state))
            .reduce((total, f) => total + f.n, 0);
        return {
          nombre,
          pendientes: n('created', 'retry'),
          activos: n('active'),
          completados: n('completed'),
          fallidos: n('failed'),
          cancelados: n('cancelled'),
        };
      });
      return { items };
    },
  );

  app.get(
    '/api/admin/colas/:nombre/trabajos',
    {
      onRequest: exigirAdmin,
      schema: {
        ...base,
        summary: 'Últimos trabajos de una cola',
        params: zCola,
        querystring: zFiltroTrabajos,
        response: respuestas(z.object({ items: z.array(zTrabajo) })),
      },
    },
    async (req) => {
      const cola = exigirCola(req.params.nombre);
      if (!(await hayEsquema())) return { items: [] };
      const { estado, limite } = req.query;
      const r = await db.execute<FilaTrabajo>(sql`
        select id, name, state::text as state, data, output, retry_count, retry_limit,
               created_on, started_on, completed_on
        from pgboss.job
        where name = ${cola} ${estado ? sql`and state::text = ${estado}` : sql``}
        order by created_on desc, id
        limit ${limite}`);
      return {
        items: r.rows.map((f) => ({
          id: f.id,
          cola: f.name,
          estado: f.state,
          datos: depurar(f.data),
          salida: depurar(f.output),
          intentos: f.retry_count,
          maxIntentos: f.retry_limit,
          creadoAt: iso(f.created_on),
          iniciadoAt: f.started_on ? iso(f.started_on) : null,
          finalizadoAt: f.completed_on ? iso(f.completed_on) : null,
        })),
      };
    },
  );

  async function estadoDe(cola: NombreCola, id: string): Promise<Trabajo['estado']> {
    if (await hayEsquema()) {
      const r = await db.execute<{ state: Trabajo['estado'] }>(
        sql`select state::text as state from pgboss.job where name = ${cola} and id = ${id}`,
      );
      if (r.rows[0]) return r.rows[0].state;
    }
    throw noEncontrado('El trabajo');
  }

  const accion = (
    nombre: 'reintentar' | 'cancelar',
    summary: string,
    ejecutar: (cola: NombreCola, id: string, estado: Trabajo['estado']) => Promise<boolean>,
  ) =>
    app.post(
      `/api/admin/colas/:nombre/trabajos/:id/${nombre}`,
      {
        onRequest: exigirAdmin,
        schema: { ...base, summary, params: zColaTrabajo, response: respuestas(zOk) },
      },
      async (req) => {
        const cola = exigirCola(req.params.nombre);
        const { id } = req.params;
        if (!(await ejecutar(cola, id, await estadoDe(cola, id))))
          throw new ErrorHttp(409, 'conflicto', `El estado actual del trabajo no permite ${nombre}lo.`);
        req.log.info({ cola, trabajoId: id, usuarioId: req.usuario?.id }, `Trabajo: ${nombre}`);
        return { ok: true as const };
      },
    );

  accion('reintentar', 'Vuelve a encolar un trabajo fallido o cancelado', async (cola, id, estado) => {
    if (estado !== 'failed' && estado !== 'cancelled') return false;
    const b = await conectarBoss();
    const r = estado === 'failed' ? await b.retry(cola, id) : await b.resume(cola, id);
    return r.affected > 0;
  });
  accion('cancelar', 'Cancela un trabajo pendiente o en curso', async (cola, id, estado) => {
    if (estado !== 'created' && estado !== 'retry' && estado !== 'active') return false;
    return (await (await conectarBoss()).cancel(cola, id)).affected > 0;
  });
};
