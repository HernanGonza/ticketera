/**
 * Plantilla HTML con la marca, compatible con clientes de correo (tablas y estilos en línea), y su versión
 * en texto plano. Recibe texto sin formato: todo se escapa acá.
 */
import { COLORES_MARCA as C, EMAIL_CONTACTO, GOBIERNO, MINISTERIO, NOMBRE_PREFIJO, NOMBRE_SISTEMA, NOMBRE_SUFIJO } from '@eco/shared/marca';

export interface ContenidoMail {
  asunto: string;
  titulo: string;
  nombre: string;
  parrafos: string[];
  datos?: [etiqueta: string, valor: string][];
  citas?: { autor: string; fecha: string; texto: string }[];
  boton?: { texto: string; url: string };
  /** Aclaración final en letra chica. */
  nota?: string;
}

export interface Mail {
  asunto: string;
  html: string;
  texto: string;
}

export const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const conSaltos = (s: string) => escapar(s).replace(/\r?\n/g, '<br>');

/** Flor de lapacho armada con celdas redondeadas (sin imágenes ni SVG). */
function flor(): string {
  const celda = (color: string) =>
    color
      ? `<td width="12" height="12" bgcolor="${color}" style="width:12px;height:12px;border-radius:6px;font-size:0;line-height:0">&nbsp;</td>`
      : '<td width="12" height="12" style="width:12px;height:12px;font-size:0;line-height:0">&nbsp;</td>';
  const p = C.lapachoClaro;
  const filas = [
    ['', p, ''],
    [p, C.lapacho, p],
    [p, '', p],
  ];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${filas
    .map((f) => `<tr>${f.map(celda).join('')}</tr>`)
    .join('')}</table>`;
}

const fuente = "font-family:'Oak Sans',Arial,Helvetica,sans-serif";

export function renderizar(c: ContenidoMail): Mail {
  const asunto = c.asunto.replace(/\s+/g, ' ').trim();
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${conSaltos(t)}</p>`;
  const datos = c.datos?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:collapse">${c.datos
        .map(
          ([k, v]) =>
            `<tr><td valign="top" style="padding:6px 12px 6px 0;border-bottom:1px solid ${C.beige};font-size:13px;color:${C.verde};font-weight:bold;white-space:nowrap">${escapar(k)}</td><td style="padding:6px 0;border-bottom:1px solid ${C.beige};font-size:14px">${conSaltos(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const citas = (c.citas ?? [])
    .map(
      (m) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td bgcolor="${C.beige}" style="padding:12px 14px;border-left:4px solid ${C.lapacho}"><div style="font-size:12px;color:${C.verde};font-weight:bold;margin-bottom:4px">${escapar(m.autor)} · ${escapar(m.fecha)}</div><div style="font-size:14px;line-height:1.5">${conSaltos(m.texto)}</div></td></tr></table>`,
    )
    .join('');
  const boton = c.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 6px"><tr><td bgcolor="${C.verde}" style="border-radius:8px"><a href="${escapar(c.boton.url)}" style="display:inline-block;padding:12px 22px;color:${C.blanco};font-size:15px;font-weight:bold;text-decoration:none">${escapar(c.boton.texto)}</a></td></tr></table><p style="margin:0 0 14px;font-size:12px;line-height:1.5;word-break:break-all">Si el botón no funciona, copie este enlace en su navegador:<br><a href="${escapar(c.boton.url)}" style="color:${C.verde}">${escapar(c.boton.url)}</a></p>`
    : '';
  const nota = c.nota ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.5">${conSaltos(c.nota)}</p>` : '';

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(asunto)}</title></head>
<body style="margin:0;padding:0;background:${C.beige};color:${C.texto};${fuente}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.beige}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.blanco};border-radius:12px;color:${C.texto};${fuente}">
<tr><td style="padding:18px 24px;border-bottom:4px solid ${C.verde}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px">${flor()}</td><td style="font-size:22px;font-weight:bold;${fuente}"><span style="color:${C.verde}">${NOMBRE_PREFIJO}</span><span style="color:${C.lapacho}">${NOMBRE_SUFIJO}</span></td></tr></table></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:19px;color:${C.verde}">${escapar(c.titulo)}</h1>
${p(`Hola, ${c.nombre}:`)}
${c.parrafos.map(p).join('')}${datos}${citas}${boton}${nota}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${C.beige};font-size:12px;line-height:1.5">${escapar(MINISTERIO)} · ${escapar(GOBIERNO)}<br>Este es un mensaje automático de ${NOMBRE_SISTEMA}; no lo responda. Consultas: ${EMAIL_CONTACTO}</td></tr>
</table>
</td></tr></table>
</body>
</html>
`;

  const texto = [
    NOMBRE_SISTEMA,
    '',
    c.titulo,
    '',
    `Hola, ${c.nombre}:`,
    '',
    ...c.parrafos.flatMap((t) => [t, '']),
    ...(c.datos?.length ? [...c.datos.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(c.citas ?? []).flatMap((m) => [`${m.autor} (${m.fecha}):`, m.texto, '']),
    ...(c.boton ? [`${c.boton.texto}: ${c.boton.url}`, ''] : []),
    ...(c.nota ? [c.nota, ''] : []),
    `${MINISTERIO} · ${GOBIERNO}`,
    `Este es un mensaje automático de ${NOMBRE_SISTEMA}; no lo responda. Consultas: ${EMAIL_CONTACTO}`,
  ].join('\n');

  return { asunto, html, texto };
}
