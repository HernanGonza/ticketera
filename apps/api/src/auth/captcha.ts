/** ALTCHA autoalojado (protocolo v1, el del widget `altcha` 2.x) con vencimiento y un solo uso. */
import { createChallenge, verifySolution } from 'altcha-lib/v1';
import type { Config } from '../config';
import type { Ejecutor } from '../db';
import { ErrorHttp } from '../errores';
import { usarUnaVez } from './portal-jwt';

export const VIGENCIA_DESAFIO_MS = 10 * 60_000;

type ConfigCaptcha = Pick<Config, 'ALTCHA_HMAC_KEY' | 'ALTCHA_COSTO'>;

export const crearDesafio = (config: ConfigCaptcha, ahora = Date.now()) =>
  createChallenge({
    algorithm: 'SHA-256',
    hmacKey: config.ALTCHA_HMAC_KEY,
    maxnumber: config.ALTCHA_COSTO,
    expires: new Date(ahora + VIGENCIA_DESAFIO_MS),
  });

const invalido = () =>
  new ErrorHttp(400, 'captcha_invalido', 'La verificación no es válida o venció. Vuelva a completarla.');

/** Lanza 400 `captcha_invalido` si la solución es falsa, venció o ya se usó. */
export async function exigirCaptcha(db: Ejecutor, config: ConfigCaptcha, payload: string): Promise<void> {
  let datos: { algorithm?: unknown; challenge?: unknown; salt?: unknown };
  try {
    datos = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    throw invalido();
  }
  if (datos?.algorithm !== 'SHA-256' || typeof datos.salt !== 'string' || !/[?&]expires=\d+&/.test(datos.salt))
    throw invalido();
  const valida = await verifySolution(payload, config.ALTCHA_HMAC_KEY, true).catch(() => false);
  if (!valida) throw invalido();
  // La clave es el hash del desafío: no cambia aunque se reordene el contenido del envío.
  const nueva = await usarUnaVez(db, `altcha:${datos.challenge}`, new Date(Date.now() + VIGENCIA_DESAFIO_MS));
  if (!nueva) throw invalido();
}
