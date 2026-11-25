import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

/** Crea una base vacía y aislada. Quien la usa corre las migraciones que necesite. */
export async function crearBaseTemporal() {
  const principal = inject('pgUrl');
  const nombre = `t_${randomBytes(6).toString('hex')}`;
  const ejecutar = async (texto: string) => {
    const c = new pg.Client({ connectionString: principal });
    await c.connect();
    try {
      await c.query(texto);
    } finally {
      await c.end();
    }
  };
  await ejecutar(`create database ${nombre}`);
  const url = new URL(principal);
  url.pathname = `/${nombre}`;
  return { url: url.toString(), destruir: () => ejecutar(`drop database if exists ${nombre} with (force)`) };
}
