/** Límite de intentos por ventana fija, en memoria (hay un solo proceso de API). */
import { ErrorHttp } from '../errores';

const TOPE_CLAVES = 20_000;

export function crearLimitador(maximo: number, ventanaMs: number) {
  const cuentas = new Map<string, { n: number; hasta: number }>();
  return {
    /** Cuenta un intento; al superar el máximo lanza 429 con los segundos de espera. */
    consumir(clave: string, ahora = Date.now()): void {
      let c = cuentas.get(clave);
      if (!c || c.hasta <= ahora) {
        if (cuentas.size >= TOPE_CLAVES) {
          for (const [k, v] of cuentas) if (v.hasta <= ahora) cuentas.delete(k);
          if (cuentas.size >= TOPE_CLAVES) cuentas.delete(cuentas.keys().next().value!);
        }
        cuentas.set(clave, (c = { n: 0, hasta: ahora + ventanaMs }));
      }
      if (++c.n > maximo)
        throw new ErrorHttp(429, 'demasiados_intentos', 'Se registraron demasiados intentos. Espere unos minutos.', {
          reintentarEnSeg: Math.ceil((c.hasta - ahora) / 1000),
        });
    },
  };
}
export type Limitador = ReturnType<typeof crearLimitador>;
