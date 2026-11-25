import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
// @ts-expect-error script ESM sin tipos
import { iniciarPostgres } from '../../scripts/postgres.mjs';

const puertoLibre = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

/** Un único Postgres temporal para toda la corrida (o TEST_DATABASE_URL). */
export default async function (proyecto: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    proyecto.provide('pgUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'eco-pg-'));
  const servidor = await iniciarPostgres({ dir: path.join(dir, 'pg'), port: await puertoLibre() });
  proyecto.provide('pgUrl', servidor.url);
  return async () => {
    await servidor.detener();
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgUrl: string;
  }
}
