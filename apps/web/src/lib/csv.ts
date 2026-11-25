export type Celda = string | number | null | undefined;

/** CSV para Excel en español: separador `;`, BOM y protección contra fórmulas. */
export function aCsv(filas: readonly (readonly Celda[])[]): string {
  const celda = (v: Celda) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
}

export function descargar(nombre: string, contenido: Blob | string) {
  const url = typeof contenido === 'string' ? contenido : URL.createObjectURL(contenido);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof contenido !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const descargarCsv = (nombre: string, filas: readonly (readonly Celda[])[]) =>
  descargar(nombre, new Blob([aCsv(filas)], { type: 'text/csv;charset=utf-8' }));
