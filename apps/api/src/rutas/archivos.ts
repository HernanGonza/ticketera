/** Validación de adjuntos: tipo real, extensión y nombre. */
import { open } from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';

const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';

/** Extensión admitida → tipo MIME con el que se guarda y se sirve. */
export const MIME_POR_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  docx: `${OOXML}.wordprocessingml.document`,
  xlsx: `${OOXML}.spreadsheetml.sheet`,
  pptx: `${OOXML}.presentationml.presentation`,
  odt: `${ODF}.text`,
  ods: `${ODF}.spreadsheet`,
  odp: `${ODF}.presentation`,
  txt: 'text/plain',
  csv: 'text/csv',
  log: 'text/plain',
  zip: 'application/zip',
  mp4: 'video/mp4',
};
const TEXTO = new Set(['txt', 'csv', 'log']);
const BINARIO_ANTIGUO = ['doc', 'xls', 'ppt'];
const DENTRO_DE_ZIP = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
const DETECTADOS = new Set(['png', 'jpg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'mp4']);

export const extensionDe = (nombre: string) => /\.([a-z0-9]{1,8})$/i.exec(nombre)?.[1]?.toLowerCase() ?? '';

/** Nombre original sin rutas, caracteres de control ni marcas de dirección; como mucho 120 caracteres. */
export function sanearNombre(original: string): string {
  const limpio = (original.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>:"|?*]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const ext = extensionDe(limpio);
  const base = ext ? limpio.slice(0, -(ext.length + 1)) : limpio;
  const corta = [...base].slice(0, 110).join('') || 'archivo';
  return ext ? `${corta}.${ext}` : corta;
}

/** Texto plano (UTF-8 o Latin-1): sin bytes de control y sin ser una página o un SVG. */
async function esTexto(ruta: string): Promise<boolean> {
  const f = await open(ruta, 'r');
  try {
    const bloque = Buffer.alloc(64 * 1024);
    for (let primero = true; ; primero = false) {
      const { bytesRead } = await f.read(bloque, 0, bloque.length, null);
      if (!bytesRead) return true;
      const parte = bloque.subarray(0, bytesRead);
      for (const b of parte) if (b < 32 && b !== 9 && b !== 10 && b !== 12 && b !== 13 && b !== 27) return false;
      if (primero && /^\s*(<!doctype\s+html|<html|<svg|<script|<\?xml)/i.test(parte.toString('utf8').replace(/^\ufeff/, '')))
        return false;
    }
  } finally {
    await f.close();
  }
}

/**
 * Tipo definitivo según el contenido. Devuelve null si no se admite. Si el contenido es de un tipo
 * permitido pero la extensión no coincide, se agrega la correcta al nombre.
 */
export async function clasificarArchivo(
  ruta: string,
  nombre: string,
): Promise<{ nombre: string; mime: string; extension: string } | null> {
  const ext = extensionDe(nombre);
  const detectado = await fileTypeFromFile(ruta).catch(() => undefined);
  const aceptar = (extension: string, final = nombre) => ({
    nombre: final,
    mime: MIME_POR_EXTENSION[extension]!,
    extension,
  });
  if (!detectado) return TEXTO.has(ext) && (await esTexto(ruta)) ? aceptar(ext) : null;
  const real: string = detectado.ext;
  // Documentos antiguos de Office: contenedor compuesto (se distingue solo por la extensión).
  if (real === 'cfb') return BINARIO_ANTIGUO.includes(ext) ? aceptar(ext) : null;
  if (real === 'zip') return DENTRO_DE_ZIP.has(ext) ? aceptar(ext) : null;
  if (!DETECTADOS.has(real)) return null;
  return MIME_POR_EXTENSION[ext] === MIME_POR_EXTENSION[real]
    ? aceptar(ext)
    : aceptar(real, `${nombre}.${real}`);
}
