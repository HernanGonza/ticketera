/** CSV para planillas en español: BOM, separador `;` y protección contra inyección de fórmulas. */
export function celdaCsv(valor: string): string {
  // Excel y LibreOffice evalúan lo que empieza con estos caracteres, aun tras espacios.
  const seguro = /^[\s\u00a0\ufeff]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r\n]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}
export const aCsv = (filas: readonly (readonly string[])[]) =>
  `\ufeff${filas.map((f) => f.map(celdaCsv).join(';')).join('\r\n')}\r\n`;
