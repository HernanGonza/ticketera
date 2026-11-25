/** Esquema de validación del pedido según los campos extra de la categoría. */
import { z } from 'zod';
import type { CampoExtra } from '@eco/shared/schemas';

export type ValoresCampos = Record<string, string | boolean>;
export interface ValoresPedido {
  titulo: string;
  descripcion: string;
  ubicacion: string;
  datos: ValoresCampos;
}

// La política de seguridad de contenidos no permite evaluar código: zod sin compilación dinámica.
z.config({ jitless: true });

const OBLIGATORIO = 'Complete este campo';

function esquemaCampo(c: CampoExtra) {
  if (c.tipo === 'casilla')
    return c.requerido ? z.boolean().refine((v) => v, 'Debe marcar esta casilla') : z.boolean().optional();
  const base = z.string({ error: OBLIGATORIO }).trim().max(2000, 'Máximo 2000 caracteres');
  return base.superRefine((v, ctx) => {
    const fallo = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (!v) {
      if (c.requerido) fallo(OBLIGATORIO);
    } else if (c.tipo === 'numero' && !Number.isFinite(Number(v.replace(',', '.')))) fallo('Ingrese un número');
    else if (c.tipo === 'fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fallo('Ingrese una fecha válida');
    else if (c.tipo === 'seleccion' && !c.opciones?.includes(v)) fallo('Elija una opción de la lista');
  });
}

export function esquemaPedido(campos: readonly CampoExtra[]) {
  return z.object({
    titulo: z.string().trim().min(4, 'Escriba un título de al menos 4 caracteres').max(150, 'Máximo 150 caracteres'),
    descripcion: z.string().trim().min(5, 'Describa el problema').max(10_000, 'Máximo 10000 caracteres'),
    ubicacion: z.string().trim().max(120, 'Máximo 120 caracteres'),
    datos: z.object(Object.fromEntries(campos.map((c) => [c.clave, esquemaCampo(c)]))),
  });
}

export function valoresIniciales(campos: readonly CampoExtra[]): ValoresPedido {
  return {
    titulo: '',
    descripcion: '',
    ubicacion: '',
    datos: Object.fromEntries(campos.map((c) => [c.clave, c.tipo === 'casilla' ? false : ''])),
  };
}

/** Convierte los valores del formulario a `datos` de la API: números reales y sin vacíos. */
export function aDatos(campos: readonly CampoExtra[], v: ValoresCampos): Record<string, string | number | boolean> {
  const r: Record<string, string | number | boolean> = {};
  for (const c of campos) {
    const x = v[c.clave];
    if (c.tipo === 'casilla') r[c.clave] = x === true;
    else if (typeof x === 'string' && x.trim())
      r[c.clave] = c.tipo === 'numero' ? Number(x.trim().replace(',', '.')) : x.trim();
  }
  return r;
}
