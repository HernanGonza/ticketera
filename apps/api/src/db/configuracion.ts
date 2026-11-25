import { CONFIGURACION_DEFAULT, zConfiguracion, type Configuracion } from '@eco/shared/schemas';
import type { Ejecutor } from './conexion';
import { configuracion } from './schema';

/** Valores guardados sobre `CONFIGURACION_DEFAULT`. Una clave inválida cae a su valor por defecto. */
export async function leerConfiguracion(db: Ejecutor): Promise<Configuracion> {
  const filas = await db.select().from(configuracion);
  const resultado: Record<string, unknown> = { ...CONFIGURACION_DEFAULT };
  const forma = zConfiguracion.shape;
  for (const f of filas) {
    if (!Object.hasOwn(forma, f.clave)) continue;
    const valor = forma[f.clave as keyof typeof forma].safeParse(f.valor);
    if (valor.success) resultado[f.clave] = valor.data;
  }
  return resultado as Configuracion;
}
