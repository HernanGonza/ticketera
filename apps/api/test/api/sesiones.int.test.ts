import { createHash, randomBytes } from 'node:crypto';
import { createChallenge, solveChallenge } from 'altcha-lib/v1';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlPortalDev } from '../../src/auth/dev';
import { cargarConfig } from '../../src/config';
import { actualizarUsuario, buscarUsuarioPorEmail, recuperacionesPassword, sesiones } from '../../src/db';
import { CONTRASENA_DEMO } from '../../src/db';
import { APP, correo, montarApi, type Api } from './base';

let e: Api;
beforeAll(async () => {
  e = await montarApi();
});
afterAll(() => e.cerrarTodo());

const usuario = async (alias: string) => (await buscarUsuarioPorEmail(e.db, correo(alias)))!;
const login = async (alias: string, password = CONTRASENA_DEMO, c = e.cliente(), altcha?: string) => ({
  c,
  r: await c.post('/api/auth/login', { email: correo(alias), password, altcha: altcha ?? (await e.captcha()) }),
});
const refrescar = (refresh: string) =>
  e.app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { eco_refresh: refresh } });
const envejecer = () => e.db.execute(sql`update sesiones set usado_at = usado_at - interval '1 minute'`);

describe('login local', () => {
  it('ingresa con correo, contraseña y ALTCHA', async () => {
    const { c, r } = await login('solicitante');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ email: correo('solicitante'), rol: 'solicitante' });
    expect((await c.get('/api/auth/yo')).statusCode).toBe(200);
  });

  it('responde lo mismo ante contraseña incorrecta, correo inexistente o cuenta sin contraseña', async () => {
    await e.db.execute(sql`update usuarios set password_hash = null where email = ${correo('lucas.ortiz')}`);
    const r = await Promise.all(
      [
        ['solicitante', 'incorrecta-123'],
        ['nadie', 'incorrecta-123'],
        ['lucas.ortiz', CONTRASENA_DEMO],
      ].map(async ([a, p]) => (await login(a!, p)).r),
    );
    for (const x of r) expect(x.statusCode).toBe(401);
    expect(new Set(r.map((x) => x.body)).size).toBe(1);
    expect(r[0]!.json().error).toBe('credenciales_invalidas');
  });

  it('un usuario bloqueado no ingresa', async () => {
    await actualizarUsuario(e.db, (await usuario('maria.lopez')).id, { activo: false });
    const { r } = await login('maria.lopez');
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('usuario_no_habilitado');
  });

  it('actualiza desde Personal y funciona aunque Personal no responda', async () => {
    const baja = await e.crear(
      {},
      {
        personal: {
          buscarPorEmail: async () => ({ nombre: 'X', area_id: 1, area_nombre: null, activo: false }),
        },
      },
    );
    expect((await login('pedro.sosa', CONTRASENA_DEMO, e.cliente(baja))).r.statusCode).toBe(403);
    expect((await usuario('pedro.sosa')).activo).toBe(false);
    const caido = await e.crear({}, { personal: { buscarPorEmail: () => Promise.reject(new Error('caído')) } });
    expect((await login('tecnico', CONTRASENA_DEMO, e.cliente(caido))).r.statusCode).toBe(200);
  });

  it('limita los intentos por IP y por correo', async () => {
    const porIp = await e.crear({ LOGIN_MAX_INTENTOS: '3' });
    const estados: number[] = [];
    for (let i = 0; i < 5; i++)
      estados.push(
        (await porIp.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode,
      );
    expect(estados).toEqual([400, 400, 400, 429, 429]);

    const porCorreo = await e.crear({ LOGIN_MAX_INTENTOS: '2', TRUST_PROXY: 'true' });
    const r = [];
    for (let i = 0; i < 3; i++)
      r.push(
        await porCorreo.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { 'x-forwarded-for': `10.0.0.${i}` },
          payload: { email: correo('Admin'), password: 'x', altcha: 'x' },
        }),
      );
    expect(r.map((x) => x.statusCode)).toEqual([400, 400, 429]);
    expect(r[2]!.json().error).toBe('demasiados_intentos');
    expect(Number(r[2]!.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('ALTCHA', () => {
  const intentar = async (altcha: string) => (await login('tecnico', CONTRASENA_DEMO, e.cliente(), altcha)).r;

  it('entrega un desafío compatible con el widget', async () => {
    const d = (await e.app.inject({ url: '/api/auth/altcha' })).json();
    expect(d).toMatchObject({ algorithm: 'SHA-256', maxnumber: 30 });
    expect(d.salt).toMatch(/^[0-9a-f]+\?expires=\d+&$/);
  });

  it('rechaza soluciones falsas, repetidas, vencidas o firmadas con otra clave', async () => {
    const bueno = await e.captcha();
    expect((await intentar(bueno)).statusCode).toBe(200);
    expect((await intentar(bueno)).json().error).toBe('captcha_invalido');
    // El mismo desafío con otro envoltorio tampoco sirve.
    const datos = JSON.parse(Buffer.from(bueno, 'base64').toString());
    const reenvuelto = Buffer.from(JSON.stringify({ ...datos, took: 1 })).toString('base64');
    expect((await intentar(reenvuelto)).json().error).toBe('captcha_invalido');

    const armar = async (hmacKey: string, expires?: Date) => {
      const d = await createChallenge({ hmacKey, maxnumber: 10, expires });
      const s = await solveChallenge(d.challenge, d.salt, d.algorithm, 10).promise;
      return Buffer.from(JSON.stringify({ ...d, number: s!.number })).toString('base64');
    };
    const clave = e.app.deps.config.ALTCHA_HMAC_KEY;
    const futuro = new Date(Date.now() + 60_000);
    for (const malo of [
      await armar(clave, new Date(Date.now() - 1000)),
      await armar(clave),
      await armar('otra-clave', futuro),
      'basura',
      Buffer.from('null').toString('base64'),
    ])
      expect((await intentar(malo)).json().error).toBe('captcha_invalido');
    expect((await intentar(await armar(clave, futuro))).statusCode).toBe(200);
  });
});

describe('sesiones', () => {
  it('rota el refresh, tolera la carrera de dos pestañas y revoca la familia ante un reuso', async () => {
    const c = await e.ingresar('tecnico');
    const primero = c.cookies.get('eco_refresh')!;
    const guardados = await e.db.select().from(sesiones);
    expect(guardados.map((s) => s.tokenHash)).not.toContain(primero);

    const a = await c.post('/api/auth/refresh');
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ rol: 'tecnico' });
    const segundo = c.cookies.get('eco_refresh')!;
    expect(segundo).not.toBe(primero);

    // Segunda pestaña, casi a la vez, con el token anterior: solo recibe un acceso nuevo.
    const b = await refrescar(primero);
    expect(b.statusCode).toBe(200);
    expect(b.cookies.map((x) => x.name)).toEqual(['eco_sesion']);

    await envejecer();
    expect((await refrescar(primero)).statusCode).toBe(401);
    expect((await refrescar(segundo)).statusCode).toBe(401);
    expect((await c.get('/api/auth/yo')).statusCode).toBe(401);
  });

  it('dos refrescos simultáneos dejan una sesión utilizable', async () => {
    const c = await e.ingresar('tecnico');
    const t = c.cookies.get('eco_refresh')!;
    const r = await Promise.all([refrescar(t), refrescar(t)]);
    expect(r.map((x) => x.statusCode)).toEqual([200, 200]);
    const nuevos = r.flatMap((x) => x.cookies).filter((x) => x.name === 'eco_refresh');
    expect(nuevos).toHaveLength(1);
    expect((await refrescar(nuevos[0]!.value)).statusCode).toBe(200);
  });

  it('rechaza refresh inexistente o vencido y limpia las cookies', async () => {
    const r = await refrescar('inventado');
    expect(r.statusCode).toBe(401);
    expect(r.cookies.map((x) => x.value)).toEqual(['', '']);
    const c = await e.ingresar('tecnico');
    await e.db.execute(sql`update sesiones set expira_at = now() - interval '1 second'`);
    expect((await c.post('/api/auth/refresh')).statusCode).toBe(401);
  });

  it('una sesión no se renueva más allá de su vida máxima', async () => {
    const c = await e.ingresar('tecnico');
    await e.db.execute(sql`update sesiones set creado_at = now() - interval '31 days'`);
    expect((await c.post('/api/auth/refresh')).statusCode).toBe(401);
  });

  it('cerrar sesión revoca en el acto y devuelve a dónde ir', async () => {
    const c = await e.ingresar('tecnico');
    const acceso = c.cookies.get('eco_sesion')!;
    const refresh = c.cookies.get('eco_refresh')!;
    const r = await c.post('/api/auth/logout');
    expect(r.json()).toEqual({ redirigirA: e.app.deps.config.portalLogoutUrl });
    expect(c.cookies.size).toBe(0);
    expect((await refrescar(refresh)).statusCode).toBe(401);
    expect((await e.app.inject({ url: '/api/auth/yo', cookies: { eco_sesion: acceso } })).statusCode).toBe(401);
    expect((await e.cliente().post('/api/auth/logout')).statusCode).toBe(200);
  });

  it.each([
    ['desactivar', { activo: false }],
    ['cambiar el rol', { rol: 'solicitante' as const }],
  ])('%s corta el acceso de inmediato y avisa', async (_n, cambios) => {
    const u = await usuario('diego.ramirez');
    await actualizarUsuario(e.db, u.id, { activo: true, rol: 'tecnico' });
    const c = e.cliente();
    expect((await login('diego.ramirez', CONTRASENA_DEMO, c)).r.statusCode).toBe(200);
    expect((await c.get('/api/kanban')).statusCode).toBe(200);
    await e.vaciarOutbox();
    await actualizarUsuario(e.db, u.id, cambios);
    expect((await c.get('/api/kanban')).statusCode).toBe(401);
    expect((await c.post('/api/auth/refresh')).statusCode).toBe(401);
    expect(await e.outbox()).toContainEqual(
      expect.objectContaining({ tipo: 'usuario.acceso_cambiado', payload: { usuarioId: u.id } }),
    );
  });

  it('un cambio de rol hecho por fuera tampoco se acepta con el token viejo', async () => {
    const c = await e.ingresar('carolina.duarte');
    await e.db.execute(sql`update usuarios set rol = 'solicitante' where email = ${correo('carolina.duarte')}`);
    expect((await c.get('/api/auth/yo')).statusCode).toBe(401);
  });
});

describe('recupero de contraseña', () => {
  const pedir = async (alias: string) =>
    e.app.inject({
      method: 'POST',
      url: '/api/auth/recuperar',
      payload: { email: correo(alias), altcha: await e.captcha() },
    });
  /** Lo que hace el worker al enviar el mail. */
  const generarToken = async () => {
    const ev = (await e.outbox()).filter((o) => o.tipo === 'auth.recuperacion_solicitada').at(-1)!;
    const token = randomBytes(32).toString('base64url');
    const id = (ev.payload as { recuperacionId: string }).recuperacionId;
    await e.db
      .update(recuperacionesPassword)
      .set({ tokenHash: createHash('sha256').update(token).digest('hex') })
      .where(eq(recuperacionesPassword.id, id));
    return { token, id };
  };
  const restablecer = (token: string, password = 'una-clave-bien-nueva') =>
    e.app.inject({ method: 'POST', url: '/api/auth/restablecer', payload: { token, password } });

  it('responde igual exista o no el correo y solo emite para un usuario activo', async () => {
    await e.vaciarOutbox();
    const nadie = await pedir('nadie');
    await actualizarUsuario(e.db, (await usuario('ana.villalba')).id, { activo: false });
    await e.vaciarOutbox();
    const inactivo = await pedir('ana.villalba');
    expect(await e.outbox()).toHaveLength(0);
    const real = await pedir('solicitante');
    expect([nadie.body, inactivo.body, real.body]).toEqual(Array(3).fill('{"ok":true}'));
    expect((await e.outbox()).map((o) => o.tipo)).toEqual(['auth.recuperacion_solicitada']);
  });

  it('el enlace sirve una sola vez y revoca las sesiones', async () => {
    const c = await e.ingresar('gabriela.silva');
    await pedir('gabriela.silva');
    const { token } = await generarToken();
    const dos = await Promise.all([restablecer(token), restablecer(token)]);
    expect(dos.map((x) => x.statusCode).sort()).toEqual([200, 400]);
    expect((await restablecer(token)).json().error).toBe('token_invalido');
    expect((await c.get('/api/auth/yo')).statusCode).toBe(401);
    expect((await c.post('/api/auth/refresh')).statusCode).toBe(401);
    expect((await login('gabriela.silva')).r.statusCode).toBe(401);
    expect((await login('gabriela.silva', 'una-clave-bien-nueva')).r.statusCode).toBe(200);
  });

  it('rechaza enlaces vencidos, reemplazados, inventados y contraseñas cortas', async () => {
    await pedir('hector.medina');
    const viejo = await generarToken();
    await pedir('hector.medina');
    expect((await restablecer(viejo.token)).statusCode).toBe(400);
    const nuevo = await generarToken();
    expect((await restablecer(nuevo.token, 'corta')).json().error).toBe('validacion');
    await e.db.execute(sql`update recuperaciones_password set expira_at = now() - interval '1 second'`);
    expect((await restablecer(nuevo.token)).statusCode).toBe(400);
    expect((await restablecer('x'.repeat(43))).statusCode).toBe(400);
  });

  it('limita los pedidos por correo', async () => {
    const app = await e.crear({ LOGIN_MAX_INTENTOS: '100' });
    const estados = [];
    for (let i = 0; i < 6; i++)
      estados.push(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/recuperar',
            payload: { email: correo('natalia.rojas'), altcha: await e.captcha() },
          })
        ).statusCode,
      );
    expect(estados).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('modo desarrollo y producción', () => {
  it('ofrece accesos de prueba que ingresan de verdad', async () => {
    const config = (await e.app.inject({ url: '/api/auth/config' })).json();
    expect(config.modoDev).toBe(true);
    expect(config.accesosDev.map((a: { rol: string }) => a.rol)).toEqual(['solicitante', 'tecnico', 'admin']);
    const { url } = (
      await e.app.inject({ method: 'POST', url: '/api/auth/dev/token', payload: { rol: 'admin' } })
    ).json();
    expect(url.startsWith(`${APP}/auth/portal?token=`)).toBe(true);
    const c = e.cliente();
    expect((await c.get(url.slice(APP.length))).headers.location).toBe('/');
    expect((await c.get('/api/auth/yo')).json().rol).toBe('admin');
  });

  it('en producción no existe el token de prueba y las cookies son Secure', async () => {
    const entorno = {
      NODE_ENV: 'production',
      SESSION_SECRET: 's'.repeat(40),
      ALTCHA_HMAC_KEY: 'a'.repeat(40),
    };
    const app = await e.crear(entorno);
    const r = await app.inject({ method: 'POST', url: '/api/auth/dev/token', payload: { rol: 'admin' } });
    expect(r.statusCode).toBe(404);
    expect((await app.inject({ url: '/api/auth/config' })).json()).toMatchObject({ modoDev: false, accesosDev: [] });
    const entrada = await app.inject({ url: `/auth/portal?token=${await e.token({ email: correo('tecnico') })}` });
    expect((entrada.cookies as { secure?: boolean }[]).every((x) => x.secure)).toBe(true);
    await expect(
      urlPortalDev(cargarConfig({ ...entorno, PORTAL_JWT_SECRET: 'p'.repeat(40) }), correo('admin')),
    ).rejects.toThrow();
  });
});

describe('protecciones generales', () => {
  it('rechaza mutaciones desde otro origen', async () => {
    const c = await e.ingresar('tecnico');
    const con = (origin: string) =>
      c.pedir({ method: 'POST', url: '/api/notificaciones/leer', payload: {}, headers: { origin } });
    expect((await con('https://malo.example')).statusCode).toBe(403);
    expect((await con('null')).statusCode).toBe(403);
    expect((await con(`${APP}.malo.example`)).statusCode).toBe(403);
    expect((await con(APP)).statusCode).toBe(200);
    expect(
      (await e.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://malo.example' } }))
        .statusCode,
    ).toBe(403);
  });

  it('no habilita CORS y envía encabezados de seguridad', async () => {
    const r = await e.app.inject({ url: '/api/health', headers: { origin: 'https://malo.example' } });
    expect(r.json()).toEqual({ ok: true, db: true, version: '1.0.0' });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  });

  it('responde los errores en español, sin detalles internos', async () => {
    const noExiste = await e.app.inject({ url: '/api/nada' });
    expect(noExiste.json()).toEqual({ error: 'no_encontrado', mensaje: expect.any(String) });
    const json = await e.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{mal',
    });
    expect(json.statusCode).toBe(400);
    expect(json.json().error).toBe('validacion');
    const campos = await e.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x' } });
    expect(campos.json().detalles.campos).toHaveProperty('email');
    expect(campos.body).not.toMatch(/stack| at /);
    const rota = await e.app.inject({ url: '/api/%E0%A4%A?token=secreto' });
    expect(rota.statusCode).toBe(400);
    expect(rota.body).not.toContain('secreto');
  });

  it('documenta la API y sirve Swagger UI propio', async () => {
    expect((await e.app.inject({ url: '/api/docs' })).statusCode).toBeLessThan(400);
    const spec = (await e.app.inject({ url: '/api/docs/json' })).json();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/auth/portal', '/api/tickets/{id}', '/api/admin/usuarios']),
    );
    expect(spec.paths['/api/tickets/{id}'].get.responses['200']).toBeDefined();
    const pagina = await e.app.inject({ url: '/api/docs/static/index.html' });
    expect(pagina.body).not.toMatch(/https?:\/\/(unpkg|cdn)/);
  });

  it('nunca registra tokens, contraseñas ni cookies', async () => {
    const lineas: string[] = [];
    const app = await e.crear({ LOG_LEVEL: 'trace' }, { log: { write: (l) => void lineas.push(l) } });
    const t = await e.token({ email: correo('tecnico') });
    const c = e.cliente(app);
    await c.get(`/auth/portal?token=${t}`);
    await c.get(`/auth/portal?token=${t}`);
    await c.get(`/auth/portal?%74oken=${t}`);
    await c.get(`/no-existe?token=${t}`);
    await c.get(`/no-existe/${t}`);
    await c.get(`/auth/portal?redirect=${encodeURIComponent(`/x?token=${t}`)}`);
    await c.get(`/api/%E0%A4%A?token=${t}`);
    await c.post(`/auth/portal`, { token: t });
    await c.post('/api/auth/login', { email: correo('tecnico'), password: 'clave-super-secreta', altcha: 'x' });
    await c.get('/api/auth/yo');
    const todo = lineas.join('');
    expect(todo).toContain('/auth/portal');
    for (const secreto of [t, t.split('.')[2]!, 'clave-super-secreta', ...c.cookies.values()])
      expect(todo).not.toContain(secreto);
  });

  it('un error de la base no registra los parámetros de la consulta', async () => {
    const lineas: string[] = [];
    const app = await e.crear({ LOG_LEVEL: 'info' }, { log: { write: (l) => void lineas.push(l) } });
    const c = await e.ingresar('admin', app);
    await e.db.execute(sql`alter table areas add constraint prueba check (nombre <> 'dato-reservado')`);
    const r = await c.post('/api/admin/areas', { nombre: 'dato-reservado' });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('dato-reservado');
    expect(lineas.join('')).toContain('23514');
    expect(lineas.join('')).not.toContain('dato-reservado');
    await e.db.execute(sql`alter table areas drop constraint prueba`);
  });
});
