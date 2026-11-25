import { afterEach, describe, expect, it, vi } from 'vitest';
import { alExpirarSesion, api, aQuery, ErrorApiCliente } from '../src/lib/api';

const respuesta = (status: number, cuerpo: unknown = {}) => new Response(JSON.stringify(cuerpo), { status });
const sinSesion = () => respuesta(401, { error: 'no_autenticado', mensaje: 'Sin sesión' });
afterEach(() => vi.unstubAllGlobals());

describe('cliente de la API', () => {
  it('hace un único refresh para pedidos concurrentes y reintenta', async () => {
    let renovada = false;
    const f = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        await new Promise((r) => setTimeout(r, 5));
        renovada = true;
        return respuesta(200);
      }
      return renovada ? respuesta(200, { url }) : sinSesion();
    });
    vi.stubGlobal('fetch', f);
    await expect(Promise.all([api('/api/a'), api('/api/b'), api('/api/c')])).resolves.toHaveLength(3);
    expect(f.mock.calls.filter((c) => c[0] === '/api/auth/refresh')).toHaveLength(1);
  });

  it('si no puede renovar avisa que la sesión expiró', async () => {
    const expirar = vi.fn();
    alExpirarSesion(expirar);
    vi.stubGlobal('fetch', async () => sinSesion());
    await expect(api('/api/a')).rejects.toMatchObject({ status: 401, codigo: 'no_autenticado' });
    expect(expirar).toHaveBeenCalledOnce();
  });

  it('no refresca en el ingreso y propaga el mensaje del servidor', async () => {
    const f = vi.fn(async () => respuesta(401, { error: 'credenciales_invalidas', mensaje: 'Datos incorrectos' }));
    vi.stubGlobal('fetch', f);
    await expect(api('/api/auth/login', { metodo: 'POST', cuerpo: {} })).rejects.toThrow('Datos incorrectos');
    expect(f).toHaveBeenCalledOnce();
  });

  it('informa los cortes de red', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('x');
    });
    await expect(api('/api/a')).rejects.toBeInstanceOf(ErrorApiCliente);
  });

  it('arma la query omitiendo vacíos y uniendo listas', () => {
    expect(aQuery({ a: 1, b: '', c: undefined, d: ['x', 'y'], e: false, f: true })).toBe('?a=1&d=x%2Cy&f=true');
    expect(aQuery({})).toBe('');
  });
});
