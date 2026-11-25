import type { CampoExtra, GuardarCategoria } from '@eco/shared/schemas';

/** Clave técnica (a-z, 0-9, _) a partir de la etiqueta, sin repetir. */
export function claveDesdeEtiqueta(etiqueta: string, usadas: readonly string[] = []): string {
  const base =
    etiqueta
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || 'campo';
  let clave = base;
  for (let i = 2; usadas.includes(clave); i++) clave = `${base}_${i}`;
  return clave;
}

export interface CampoEditable extends Omit<CampoExtra, 'opciones'> {
  /** Una opción por línea. */
  opcionesTexto: string;
  /** Identidad estable en el editor. */
  uid: string;
  /** La clave de un campo ya guardado no cambia (los tickets la referencian). */
  guardado: boolean;
}

export function aCampos(editables: readonly CampoEditable[]): CampoExtra[] {
  const usadas: string[] = [];
  return editables.map((c) => {
    const clave = c.guardado ? c.clave : claveDesdeEtiqueta(c.etiqueta, usadas);
    usadas.push(clave);
    return {
      clave,
      etiqueta: c.etiqueta.trim(),
      tipo: c.tipo,
      requerido: c.requerido,
      ayuda: c.ayuda?.trim() || undefined,
      opciones:
        c.tipo === 'seleccion'
          ? [...new Set(c.opcionesTexto.split('\n').map((o) => o.trim()).filter(Boolean))]
          : undefined,
    };
  });
}

export function validarCategoria(c: GuardarCategoria): string[] {
  const e: string[] = [];
  if (c.nombre.trim().length < 2) e.push('Escriba un nombre de al menos 2 caracteres.');
  for (const [valor, nombre] of [
    [c.slaRespuestaMin, 'respuesta'],
    [c.slaResolucionMin, 'resolución'],
  ] as const)
    if (!Number.isInteger(valor) || valor < 5 || valor > 100_000)
      e.push(`El plazo de ${nombre} debe estar entre 5 y 100000 minutos.`);
  if (c.modoAsignacion === 'fija' && !c.tecnicoDefaultId) e.push('Elija el técnico de la asignación fija.');
  for (const campo of c.campos ?? []) {
    if (!campo.etiqueta) e.push('Todos los campos extra necesitan una etiqueta.');
    if (campo.tipo === 'seleccion' && !campo.opciones?.length)
      e.push(`El campo «${campo.etiqueta}» necesita al menos una opción.`);
    if ((campo.opciones?.length ?? 0) > 40) e.push(`El campo «${campo.etiqueta}» admite hasta 40 opciones.`);
  }
  return [...new Set(e)];
}
