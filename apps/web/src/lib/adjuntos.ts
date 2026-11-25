export function formatearBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
export const esImagen = (mime: string) => /^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime);

/** Archivos del portapapeles; las capturas pegadas reciben un nombre distinguible. */
export function archivosPegados(datos: DataTransfer | null, ahora = new Date()): File[] {
  const sello = ahora.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return Array.from(datos?.files ?? []).map((f, i) =>
    f.name === 'image.png' || !f.name
      ? new File([f], `captura-${sello}${i ? `-${i}` : ''}.png`, { type: f.type })
      : f,
  );
}

export function separarPorTamano(archivos: File[], maxMb: number) {
  const max = maxMb * 1024 * 1024;
  return { aceptados: archivos.filter((a) => a.size <= max && a.size > 0), rechazados: archivos.filter((a) => a.size > max || a.size === 0) };
}
