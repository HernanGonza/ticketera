import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { exportJWK, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PersonalPostgresProvider } from '../../src/auth/personal';
import { actualizarUsuario, buscarUsuarioPorEmail } from '../../src/db';
import { crearBaseTemporal } from '../../../../tests/helpers/db';
import pg from 'pg';
import { CLAVE_PORTAL, correo, montarApi, type Api } from './base';

let e: Api;
beforeAll(async () => {
  e = await montarApi();
});
afterAll(() => e.cerrarTodo());

const entrar = async (token: string, extra = '') => {
  const c = e.cliente();
  const r = await c.get(`/auth/portal?token=${token}${extra}`);
  return { c, r, destino: r.headers.location };
};
const rechazado = async (token: string) => {
  const { r, c, destino } = await entrar(token);
  expect(r.statusCode).toBe(303);
  expect(destino).toBe('/login?error=token_invalido');
  expect(c.cookies.size).toBe(0);
};

describe('ingreso por el portal', () => {
  it('con un token válido abre la sesión y redirige sin el token', async () => {
    const t = await e.token({ email: 'SOLICITANTE@Ecologia.Misiones.gob.ar', extra: 1 });
    const { c, r, destino } = await entrar(t, '&redirect=%2Ftickets%2FTCK-2026-000001%3Fcalificar%3D1');
    expect(r.statusCode).toBe(303);
    expect(destino).toBe('/tickets/TCK-2026-000001?calificar=1');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    const cookies = r.cookies as { name: string; httpOnly?: boolean; sameSite?: string; path?: string }[];
    expect(cookies.find((x) => x.name === 'eco_sesion')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookies.find((x) => x.name === 'eco_refresh')).toMatchObject({ httpOnly: true, path: '/api/auth' });
    expect([...c.cookies.values()]).not.toContain(t);
    const yo = await c.get('/api/auth/yo');
    expect(yo.json()).toMatchObject({ email: correo('solicitante'), rol: 'solicitante', areaNombre: expect.any(String) });
    expect((await buscarUsuarioPorEmail(e.db, correo('solicitante')))?.ultimoAcceso).toBeInstanceOf(Date);
  });

  it('acepta Authorization Bearer y POST en JSON o formulario (aun desde otro sitio)', async () => {
    const a = await e.app.inject({
      url: '/auth/portal',
      headers: { authorization: `Bearer ${await e.token({ email: correo('tecnico') })}` },
    });
    expect(a.headers.location).toBe('/');
    const b = await e.app.inject({
      method: 'POST',
      url: '/auth/portal',
      payload: { token: await e.token({ email: correo('tecnico') }), redirect: '/kanban' },
    });
    expect(b.headers.location).toBe('/kanban');
    const f = await e.app.inject({
      method: 'POST',
      url: '/auth/portal',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://portal.ecologia.misiones.gob.ar' },
      payload: new URLSearchParams({ token: await e.token({ email: correo('tecnico') }), redirect: '/lista' }).toString(),
    });
    expect(f.statusCode).toBe(303);
    expect(f.headers.location).toBe('/lista');
  });

  it('los formularios solo se admiten en la entrada del portal', async () => {
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/auth/dev/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'rol=admin',
    });
    expect(r.statusCode).toBe(415);
  });

  it('rechaza token vencido, sin exp, con firma o emisor incorrectos o mal formado', async () => {
    const email = correo('solicitante');
    const ahora = Math.floor(Date.now() / 1000);
    await rechazado(await e.token({ email }, { exp: ahora - 120 }));
    await rechazado(await e.token({ email }, { exp: null }));
    await rechazado(await e.token({ email }, { secreto: 'otro-secreto-cualquiera-0123456789abcdef' }));
    await rechazado(await e.token({ email }, { iss: 'otro.emisor' }));
    await rechazado('no.es.un-token');
    await rechazado(await e.token({ nombre: 'Sin correo' }));
    // Tolerancia de reloj de 30 s.
    expect((await entrar(await e.token({ email }, { exp: ahora - 10 }))).destino).toBe('/');
  });

  it('solo acepta el algoritmo configurado', async () => {
    const email = correo('solicitante');
    await rechazado(await e.token({ email }, { alg: 'HS384' }));
    await rechazado(await e.token({ email }, { alg: 'HS512' }));
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    await rechazado(
      `${b64({ alg: 'none' })}.${b64({ email, iss: 'portal.ecologia.misiones.gob.ar', exp: 4_000_000_000 })}.`,
    );
  });

  it('valida aud cuando está configurado', async () => {
    const app = await e.crear({ PORTAL_JWT_AUDIENCE: 'ecosoporte' });
    const probar = async (claims: object) =>
      (await app.inject({ url: `/auth/portal?token=${await e.token({ email: correo('tecnico'), ...claims })}` }))
        .headers.location;
    expect(await probar({})).toBe('/login?error=token_invalido');
    expect(await probar({ aud: 'otro' })).toBe('/login?error=token_invalido');
    expect(await probar({ aud: 'ecosoporte' })).toBe('/');
  });

  it('RS256 con clave pública o JWKS, sin confusión de algoritmos', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const pem = await exportSPKI(publicKey);
    const firmar = (kid?: string) =>
      new SignJWT({ email: correo('tecnico') })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('portal.ecologia.misiones.gob.ar')
        .setExpirationTime('5m')
        .sign(privateKey);
    const app = await e.crear({ PORTAL_JWT_ALG: 'RS256', PORTAL_JWT_PUBLIC_KEY: pem.replace(/\n/g, '\\n') });
    const probar = async (a: typeof app, t: string) => (await a.inject({ url: `/auth/portal?token=${t}` })).headers.location;
    expect(await probar(app, await firmar())).toBe('/');
    // HS256 firmado con la clave pública como secreto.
    expect(await probar(app, await e.token({ email: correo('admin') }, { secreto: pem }))).toBe(
      '/login?error=token_invalido',
    );
    expect(await probar(app, await e.token({ email: correo('admin') }))).toBe('/login?error=token_invalido');

    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const servidor = createServer((_q, s) => s.end(JSON.stringify({ keys: [jwk] })));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
      const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/jwks`;
      const conJwks = await e.crear({ PORTAL_JWT_ALG: 'RS256', PORTAL_JWT_SECRET: '', PORTAL_JWT_JWKS_URL: url });
      expect(await probar(conJwks, await firmar('k1'))).toBe('/');
    } finally {
      servidor.close();
    }
  });

  it('un correo que no figura en Personal queda en /no-habilitado', async () => {
    const { destino, c } = await entrar(await e.token({ email: correo('desconocido') }));
    expect(destino).toBe('/no-habilitado');
    expect(c.cookies.size).toBe(0);
    expect(await buscarUsuarioPorEmail(e.db, correo('desconocido'))).toBeNull();
  });

  it('un empleado inactivo no ingresa y uno nuevo se crea como solicitante', async () => {
    expect((await entrar(await e.token({ email: correo('baja') }))).destino).toBe('/no-habilitado');
    expect(await buscarUsuarioPorEmail(e.db, correo('baja'))).toBeNull();
    expect((await entrar(await e.token({ email: correo('nueva.empleada') }))).destino).toBe('/');
    expect(await buscarUsuarioPorEmail(e.db, correo('nueva.empleada'))).toMatchObject({
      rol: 'solicitante',
      activo: true,
      nombre: 'Camila Insaurralde',
    });
  });

  it('actualiza los datos y bloquea según Personal en cada ingreso', async () => {
    let empleado = { nombre: 'Nombre Nuevo', area_id: 99, area_nombre: 'Área recién creada', activo: true };
    const app = await e.crear({}, { personal: { buscarPorEmail: async () => empleado } });
    const c = e.cliente(app);
    const ingresar = async () =>
      (await c.get(`/auth/portal?token=${await e.token({ email: correo('maria.lopez') })}`)).headers.location;
    expect(await ingresar()).toBe('/');
    expect((await c.get('/api/auth/yo')).json()).toMatchObject({
      nombre: 'Nombre Nuevo',
      areaNombre: 'Área recién creada',
    });
    empleado = { ...empleado, activo: false };
    expect(await ingresar()).toBe('/no-habilitado');
    expect((await c.get('/api/auth/yo')).statusCode).toBe(401);
    empleado = { ...empleado, activo: true };
    expect(await ingresar()).toBe('/');
  });

  it('un bloqueo del administrador persiste aunque Personal lo informe activo', async () => {
    const u = (await buscarUsuarioPorEmail(e.db, correo('juan.gonzalez')))!;
    await actualizarUsuario(e.db, u.id, { activo: false });
    expect((await entrar(await e.token({ email: u.email }))).destino).toBe('/no-habilitado');
    expect(await buscarUsuarioPorEmail(e.db, u.email)).toMatchObject({ activo: false, bloqueado: true });
    // Editar otros datos reenviando `activo: false` no quita el bloqueo.
    await actualizarUsuario(e.db, u.id, { nombre: 'Juan', activo: false });
    expect((await entrar(await e.token({ email: u.email }))).destino).toBe('/no-habilitado');
    await actualizarUsuario(e.db, u.id, { activo: true });
    expect((await entrar(await e.token({ email: u.email }))).destino).toBe('/');
  });

  it('guardar sin cambios a un inactivo por Personal no lo bloquea', async () => {
    const u = (await buscarUsuarioPorEmail(e.db, correo('ana.villalba')))!;
    await e.db.execute(sql`update usuarios set activo = false where id = ${u.id}`);
    await actualizarUsuario(e.db, u.id, { nombre: 'Ana', activo: false });
    expect((await entrar(await e.token({ email: u.email }))).destino).toBe('/');
  });

  it('un usuario local que no figura en Personal puede ingresar', async () => {
    const app = await e.crear({}, { personal: { buscarPorEmail: async () => null } });
    const probar = async (alias: string) =>
      (await app.inject({ url: `/auth/portal?token=${await e.token({ email: correo(alias) })}` })).headers.location;
    expect(await probar('admin')).toBe('/');
    expect(await probar('nuevo.empleado')).toBe('/no-habilitado');
  });

  it('si Personal no responde, el portal informa el error', async () => {
    const app = await e.crear(
      {},
      { personal: { buscarPorEmail: async () => Promise.reject(new Error('sin conexión')) } },
    );
    const r = await app.inject({ url: `/auth/portal?token=${await e.token({ email: correo('tecnico') })}` });
    expect(r.headers.location).toBe('/login?error=interno');
    expect(r.cookies).toHaveLength(0);
  });

  it('rechaza el reuso del jti, incluso simultáneo', async () => {
    const t = await e.token({ email: correo('tecnico') }, { jti: 'una-vez' });
    // HEAD no consume el token.
    expect((await e.app.inject({ method: 'HEAD', url: `/auth/portal?token=${t}` })).statusCode).toBe(404);
    expect((await entrar(t)).destino).toBe('/');
    await rechazado(t);
    const otro = await e.token({ email: correo('tecnico') });
    const r = await Promise.all([1, 2, 3, 4].map(() => entrar(otro)));
    expect(r.filter((x) => x.destino === '/')).toHaveLength(1);
  });

  it.each([
    'https://malo.example',
    '//malo.example',
    '/\\malo.example',
    '\\\\malo.example',
    'javascript:alert(1)',
    '/%2F%2Fmalo.example',
    '/%5Cmalo.example',
    '/%252F%252Fmalo.example',
    '/.//malo.example',
    '/..//malo.example',
    '/\t/malo.example',
    '/ruta\r\nSet-Cookie: x=1',
    'kanban',
    '/api/auth/logout',
    '/auth/portal',
    '/%61pi/tickets',
  ])('ignora el redirect %j', async (redirect) => {
    const { destino } = await entrar(
      await e.token({ email: correo('tecnico') }),
      `&redirect=${encodeURIComponent(redirect)}`,
    );
    expect(destino).toBe('/');
  });

  it('quita cualquier token del redirect', async () => {
    const { destino } = await entrar(
      await e.token({ email: correo('tecnico') }),
      `&redirect=${encodeURIComponent('/lista?token=abc&pagina=2')}`,
    );
    expect(destino).toBe('/lista?pagina=2');
  });

  it('un pedido incompleto vuelve a la pantalla de ingreso', async () => {
    expect((await e.app.inject({ url: '/auth/portal' })).headers.location).toBe('/login?error=validacion');
    const r = await e.app.inject({ method: 'POST', url: '/auth/portal', payload: {} });
    expect(r.headers.location).toBe('/login?error=validacion');
  });
});

describe('usuario-existe', () => {
  const consultar = (alias: string, clave?: string, app = e.app) =>
    app.inject({
      url: `/api/sso/usuario-existe?email=${encodeURIComponent(correo(alias))}`,
      headers: clave === undefined ? {} : { 'x-portal-key': clave },
    });

  it('exige la clave correcta', async () => {
    expect((await consultar('tecnico')).statusCode).toBe(401);
    expect((await consultar('tecnico', 'incorrecta')).statusCode).toBe(401);
    expect((await consultar('tecnico', `${CLAVE_PORTAL}x`)).statusCode).toBe(401);
    // Sin clave no se valida ni la entrada.
    expect((await e.app.inject({ url: '/api/sso/usuario-existe?email=x' })).statusCode).toBe(401);
  });

  it('informa existencia y rol', async () => {
    const r = async (alias: string) => (await consultar(alias, CLAVE_PORTAL)).json();
    expect(await r('tecnico')).toEqual({ existe: true, rol: 'tecnico' });
    expect(await r('nuevo.empleado')).toEqual({ existe: true, rol: 'solicitante' });
    expect(await r('baja')).toEqual({ existe: false });
    expect(await r('desconocido')).toEqual({ existe: false });
    const u = (await buscarUsuarioPorEmail(e.db, correo('pedro.sosa')))!;
    await actualizarUsuario(e.db, u.id, { activo: false });
    expect(await r('pedro.sosa')).toEqual({ existe: false });
  });

  it('se deshabilita sin PORTAL_API_KEY y limita los intentos fallidos', async () => {
    // Con NODE_ENV=production la clave vacía no se reemplaza por la de desarrollo.
    const sinClave = await e.crear({
      NODE_ENV: 'production',
      SESSION_SECRET: 's'.repeat(40),
      ALTCHA_HMAC_KEY: 'a'.repeat(40),
      PORTAL_API_KEY: '',
    });
    expect((await consultar('tecnico', '', sinClave)).statusCode).toBe(404);
    const app = await e.crear();
    let ultimo = 0;
    for (let i = 0; i < 25; i++) ultimo = (await consultar('tecnico', 'mala', app)).statusCode;
    expect(ultimo).toBe(429);
  });
});

describe('PersonalPostgresProvider', () => {
  let base: Awaited<ReturnType<typeof crearBaseTemporal>>;
  let personal: PersonalPostgresProvider;
  beforeAll(async () => {
    base = await crearBaseTemporal();
    const c = new pg.Client({ connectionString: base.url });
    await c.connect();
    await c.query(`create table empleados (email text, nombre text, area_id int, area_nombre text, activo boolean);
      insert into empleados values
        ('Externa@Ecologia.misiones.gob.ar', 'Persona Externa', 40, 'Delegación Iguazú', true),
        ('doble@ecologia.misiones.gob.ar', 'Baja', 1, 'X', false),
        ('doble@ecologia.misiones.gob.ar', 'Alta', 1, 'X', true),
        ('inactivo@ecologia.misiones.gob.ar', 'Inactivo', null, null, false);
      create schema "Raro""s";
      create table "Raro""s"."mi tabla" ("e mail" text, "nom" text, "a" int, "an" text, "est" char(1));
      insert into "Raro""s"."mi tabla" values ('x@y.com', 'Equis', 1, 'A', 'S')`);
    await c.end();
    personal = new PersonalPostgresProvider(base.url);
  });
  afterAll(async () => {
    await personal.cerrar();
    await base.destruir();
  });

  it('busca sin distinguir mayúsculas y prioriza el registro activo', async () => {
    expect(await personal.buscarPorEmail(correo('externa'))).toEqual({
      nombre: 'Persona Externa',
      area_id: 40,
      area_nombre: 'Delegación Iguazú',
      activo: true,
    });
    expect(await personal.buscarPorEmail(correo('doble'))).toMatchObject({ nombre: 'Alta', activo: true });
    expect(await personal.buscarPorEmail(correo('inactivo'))).toMatchObject({ activo: false });
    expect(await personal.buscarPorEmail("' or 1=1 --@x.com")).toBeNull();
  });

  it('es de solo lectura', async () => {
    await expect(personal.pool.query('delete from empleados')).rejects.toThrow(/read-only|solo lectura/i);
  });

  it('escapa los identificadores configurados', async () => {
    const raro = new PersonalPostgresProvider(base.url, {
      esquema: 'Raro"s',
      tabla: 'mi tabla',
      columnas: { email: 'e mail', nombre: 'nom', areaId: 'a', areaNombre: 'an', activo: 'est' },
    });
    expect(await raro.buscarPorEmail('X@y.com')).toMatchObject({ nombre: 'Equis', activo: true });
    await raro.cerrar();
  });

  it('se usa con PERSONAL_DATABASE_URL en el ingreso', async () => {
    const app = await e.crear({ PERSONAL_DATABASE_URL: base.url });
    const r = await app.inject({ url: `/auth/portal?token=${await e.token({ email: correo('externa') })}` });
    expect(r.headers.location).toBe('/');
    expect(await buscarUsuarioPorEmail(e.db, correo('externa'))).toMatchObject({ nombre: 'Persona Externa' });
    await app.close();
  });
});
