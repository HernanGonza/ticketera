import { describe, expect, it } from 'vitest';
import { crearPersonal } from '../src/auth/personal';
import { PersonalMockProvider } from '../src/auth/personal/mock';
import { cargarConfig } from '../src/config';

const SECRETOS = { SESSION_SECRET: 's'.repeat(40), ALTCHA_HMAC_KEY: 'a'.repeat(40) };

describe('configuración de producción', () => {
  it('es el modo por defecto y no trae datos de demostración', () => {
    const c = cargarConfig(SECRETOS);
    expect(c.produccion).toBe(true);
    expect(c.seedDemo).toBe(false);
  });

  it('rechaza secretos vacíos o de ejemplo', () => {
    expect(() => cargarConfig({})).toThrow(/SESSION_SECRET/);
    expect(() =>
      cargarConfig({ ...SECRETOS, SESSION_SECRET: 'cambiar-por-una-cadena-aleatoria-de-32-o-mas-caracteres-1' }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('deshabilita el portal si sus claves son las de ejemplo', () => {
    const c = cargarConfig({
      ...SECRETOS,
      PORTAL_JWT_SECRET: 'cambiar-por-el-secreto-compartido-con-el-portal-32',
      PORTAL_API_KEY: 'cambiar-por-una-clave-larga-compartida-con-el-portal',
    });
    expect(c.PORTAL_JWT_SECRET).toBe('');
    expect(c.PORTAL_API_KEY).toBe('');
  });

  it('no usa los empleados simulados fuera de desarrollo o demo', async () => {
    const correo = 'solicitante@ecologia.misiones.gob.ar';
    expect(await crearPersonal(cargarConfig(SECRETOS)).buscarPorEmail(correo)).toBeNull();
    expect(crearPersonal(cargarConfig({ ...SECRETOS, SEED_DEMO: 'true' }))).toBeInstanceOf(PersonalMockProvider);
    expect(crearPersonal(cargarConfig({ NODE_ENV: 'development' }))).toBeInstanceOf(PersonalMockProvider);
  });
});
