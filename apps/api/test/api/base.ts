import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { solveChallenge } from 'altcha-lib/v1';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { SignJWT, type JWTPayload } from 'jose';
import { crearApp, type OpcionesApp } from '../../src/app';
import { cargarConfig } from '../../src/config';
import { montar } from '../db/base';

export const APP = 'http://localhost:5173';
export const SECRETO = 'secreto-de-prueba-del-portal-0123456789abcdef';
export const CLAVE_PORTAL = 'clave-de-prueba-del-portal-0123456789';
export const correo = (alias: string) => `${alias}@ecologia.misiones.gob.ar`;

export async function montarApi(env: Record<string, string> = {}, opciones: OpcionesApp = {}) {
  const base = await montar();
  const dir = mkdtempSync(path.join(tmpdir(), 'eco-api-'));
  const apps: { close(): PromiseLike<unknown> }[] = [];

  /** Otra instancia de la API sobre la misma base (con sus propios límites). */
  const crear = async (extra: Record<string, string> = {}, op: OpcionesApp = {}) => {
    const config = cargarConfig({
      NODE_ENV: 'test',
      APP_URL: APP,
      DATABASE_URL: base.url,
      DATA_DIR: dir,
      LOG_LEVEL: 'silent',
      ALTCHA_COSTO: '30',
      LOGIN_MAX_INTENTOS: '1000',
      PORTAL_JWT_SECRET: SECRETO,
      PORTAL_API_KEY: CLAVE_PORTAL,
      ...env,
      ...extra,
    });
    const app = await crearApp({ config, conexion: base }, { ...opciones, ...op });
    await app.ready();
    apps.push(app);
    return app;
  };
  const app = await crear();
  type App = typeof app;

  /** Cliente con su propio frasco de cookies. */
  const cliente = (destino: App = app) => {
    const cookies = new Map<string, string>();
    const pedir = async (o: InjectOptions): Promise<LightMyRequestResponse> => {
      const r = await destino.inject({ ...o, cookies: { ...Object.fromEntries(cookies), ...o.cookies } });
      for (const c of r.cookies as { name: string; value: string }[])
        if (c.value) cookies.set(c.name, c.value);
        else cookies.delete(c.name);
      return r;
    };
    return {
      cookies,
      pedir,
      get: (url: string) => pedir({ method: 'GET', url }),
      post: (url: string, payload?: object) => pedir({ method: 'POST', url, payload }),
      put: (url: string, payload?: object) => pedir({ method: 'PUT', url, payload }),
      patch: (url: string, payload?: object) => pedir({ method: 'PATCH', url, payload }),
      borrar: (url: string) => pedir({ method: 'DELETE', url }),
    };
  };

  const token = (
    claims: JWTPayload & Record<string, unknown>,
    o: { secreto?: string; alg?: string; exp?: number | string | null; iss?: string; jti?: string | null } = {},
  ) => {
    const jwt = new SignJWT(claims).setProtectedHeader({ alg: o.alg ?? 'HS256' });
    jwt.setIssuer(o.iss ?? 'portal.ecologia.misiones.gob.ar').setIssuedAt();
    if (o.exp !== null) jwt.setExpirationTime(o.exp ?? '5m');
    if (o.jti !== null) jwt.setJti(o.jti ?? crypto.randomUUID());
    return jwt.sign(new TextEncoder().encode(o.secreto ?? SECRETO));
  };

  /** Cliente ya ingresado por el portal. */
  const ingresar = async (alias: string, destino: App = app) => {
    const c = cliente(destino);
    const r = await c.get(`/auth/portal?token=${await token({ email: correo(alias) })}`);
    if (r.statusCode !== 303 || r.headers.location !== '/')
      throw new Error(`No ingresó ${alias}: ${r.statusCode} ${r.headers.location}`);
    return c;
  };

  const captcha = async (destino: App = app) => {
    const d = (await destino.inject({ url: '/api/auth/altcha' })).json();
    const s = await solveChallenge(d.challenge, d.salt, d.algorithm, d.maxnumber).promise;
    // Mismo formato que envía el widget `altcha`.
    return Buffer.from(
      JSON.stringify({
        algorithm: d.algorithm,
        challenge: d.challenge,
        number: s!.number,
        salt: d.salt,
        signature: d.signature,
        took: s!.took,
      }),
    ).toString('base64');
  };

  return {
    ...base,
    app,
    dir,
    crear,
    cliente,
    token,
    ingresar,
    captcha,
    cerrarTodo: async () => {
      for (const a of apps) await a.close();
      await base.desmontar();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type Api = Awaited<ReturnType<typeof montarApi>>;

/** Cuerpo multipart con un campo de archivo. */
export function formulario(nombre: string, contenido: Buffer | string, campo = 'archivo') {
  const limite = '----eco-prueba';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="${campo}"; filename="${nombre}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(contenido),
      Buffer.from(`\r\n--${limite}--\r\n`),
    ]),
  };
}
