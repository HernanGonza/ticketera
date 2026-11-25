import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isNull, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { crearLog } from '@eco/api/log';
import { outboxEventos } from '@eco/api/db';
import { montar } from '../../api/test/db/base';
import { configPrueba, hasta } from '../../api/test/realtime/apoyo';
import type { Mail } from '../src/mail/plantillas';
import type { Transporte } from '../src/mail/transporte';
import { iniciarWorker, type OpcionesWorker, type Worker } from '../src/worker';

export interface Enviado extends Mail {
  para: string;
}

export async function montarWorker() {
  const entorno = await montar();
  const datos = mkdtempSync(path.join(tmpdir(), 'eco-worker-'));
  const config = configPrueba(entorno.url, { DATA_DIR: datos });
  const log = crearLog('prueba', process.env.LOG_PRUEBA ?? 'silent');
  const enviados: Enviado[] = [];
  const transporte: Transporte = {
    enviar: async (para, mail) => {
      enviados.push({ para, ...mail });
      return 'enviado';
    },
    cerrar: () => {},
  };
  const workers: Worker[] = [];

  const pendientes = async () =>
    (await entorno.db.select({ id: outboxEventos.id }).from(outboxEventos).where(isNull(outboxEventos.publicadoAt)))
      .length;

  return {
    ...entorno,
    config,
    log,
    enviados,
    transporte,
    pendientes,
    usuarios: async (...alias: string[]) => {
      const r: UsuarioSesion[] = [];
      for (const a of alias) r.push(await entorno.usuario(a));
      return r;
    },
    async iniciar(opciones: OpcionesWorker = {}) {
      const w = await iniciarWorker(
        { config, conexion: entorno, log },
        { crones: false, sondeoSeg: 0.5, debounceTableroMs: 100, agrupadoSeg: 2, transporte, ...opciones },
      );
      workers.push(w);
      return w;
    },
    /** Sin eventos pendientes ni trabajos por ejecutar (incluidos los demorados). */
    async reposo(ms = 20_000) {
      await hasta(async () => {
        if (await pendientes()) return false;
        const r = await entorno.db.execute<{ n: number }>(
          sql`select count(*)::int as n from pgboss.job where state in ('created','retry','active')`,
        );
        return r.rows[0]!.n === 0 && !(await pendientes());
      }, ms);
    },
    async archivos() {
      const nombres = await readdir(config.mailsDir).catch(() => []);
      return Promise.all(
        nombres.map(async (n) => ({ nombre: n, html: await readFile(path.join(config.mailsDir, n), 'utf8') })),
      );
    },
    detenerWorkers: async () => {
      for (const w of workers.splice(0)) await w.detener();
    },
    async desmontar() {
      for (const w of workers) await w.detener();
      await entorno.desmontar();
      rmSync(datos, { recursive: true, force: true });
    },
  };
}
export type EntornoWorker = Awaited<ReturnType<typeof montarWorker>>;
