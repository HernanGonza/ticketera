/**
 * Arma y envía el correo de un trabajo. El trabajo solo trae identificadores: los datos se leen al enviar
 * y se vuelve a comprobar que el aviso siga teniendo sentido y que el destinatario pueda verlo.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import {
  extracto,
  lecturas,
  mensajes,
  obtenerTicketResumen,
  recuperacionesPassword,
  usuarios,
  type Ejecutor,
} from '@eco/api/db';
import {
  esStaff,
  ETIQUETA_ESTADO,
  ETIQUETA_PRIORIDAD,
  formatearFechaHora,
  type Estado,
} from '@eco/shared/dominio';
import type { TrabajoMail } from '@eco/shared/colas';
import { NOMBRE_SISTEMA } from '@eco/shared/marca';
import type { TicketResumen } from '@eco/shared/schemas';
import { renderizar, type ContenidoMail } from './plantillas';
import type { ResultadoEnvio, Transporte } from './transporte';

export interface DepsMail {
  db: Ejecutor;
  transporte: Transporte;
  appUrl: string;
}
export type ResultadoMail = ResultadoEnvio | 'sin_efecto';

const MAX_CITAS = 10;
const estado = (e: string) => ETIQUETA_ESTADO[e as Estado] ?? e;

async function usuarioActivo(db: Ejecutor, id: string) {
  const [u] = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email, rol: usuarios.rol })
    .from(usuarios)
    .where(and(eq(usuarios.id, id), eq(usuarios.activo, true)));
  return u;
}

/** Mensajes públicos ajenos, desde `desde`, que el destinatario todavía no leyó. */
async function sinLeer(db: Ejecutor, ticketId: string, usuarioId: string, desde: string) {
  return db
    .select({ cuerpo: mensajes.cuerpo, creadoAt: mensajes.creadoAt, autor: usuarios.nombre })
    .from(mensajes)
    .innerJoin(usuarios, eq(usuarios.id, mensajes.autorId))
    .leftJoin(lecturas, and(eq(lecturas.ticketId, mensajes.ticketId), eq(lecturas.usuarioId, usuarioId)))
    .where(
      and(
        eq(mensajes.ticketId, ticketId),
        sql`not ${mensajes.interno}`,
        sql`${mensajes.autorId} <> ${usuarioId}`,
        gte(mensajes.creadoAt, new Date(desde)),
        sql`(${lecturas.ultimoMensajeAt} is null or ${mensajes.creadoAt} > ${lecturas.ultimoMensajeAt})`,
      ),
    )
    .orderBy(asc(mensajes.creadoAt), asc(mensajes.id));
}

function datosTicket(t: TicketResumen): [string, string][] {
  return [
    ['Pedido', t.codigo],
    ['Título', t.titulo],
    ['Categoría', t.categoriaNombre],
    ['Prioridad', ETIQUETA_PRIORIDAD[t.prioridad]],
    ['Estado', ETIQUETA_ESTADO[t.estado]],
    ['Solicitante', t.areaNombre ? `${t.solicitante.nombre} (${t.areaNombre})` : t.solicitante.nombre],
    ['Asignado a', t.asignado?.nombre ?? 'Sin asignar'],
    ['Creado', formatearFechaHora(t.creadoAt)],
  ];
}

type TrabajoTicket = Exclude<TrabajoMail, { clase: 'recuperar_password' }>;

async function contenidoTicket(
  { db, appUrl }: DepsMail,
  trabajo: TrabajoTicket,
): Promise<{ para: string; contenido: ContenidoMail } | null> {
  const [u, t] = await Promise.all([
    usuarioActivo(db, trabajo.usuarioId),
    obtenerTicketResumen(db, trabajo.ticketId),
  ]);
  if (!u || !t) return null;
  const propio = t.solicitante.id === u.id;
  const staff = esStaff(u);
  if (!propio && !staff) return null;

  const url = `${appUrl}/tickets/${t.codigo}`;
  const armar = (titulo: string, parrafos: string[], extra: Partial<ContenidoMail> = {}) => ({
    para: u.email,
    contenido: {
      asunto: `[${t.codigo}] ${titulo}: ${t.titulo}`,
      titulo,
      nombre: u.nombre,
      parrafos,
      datos: datosTicket(t),
      boton: { texto: 'Ver el pedido', url },
      ...extra,
    },
  });

  switch (trabajo.clase) {
    case 'ticket_creado':
      return propio
        ? armar('Recibimos su pedido', [
            `Su pedido quedó registrado con el código ${t.codigo}. Le avisaremos por este medio cada vez que haya novedades.`,
          ])
        : armar('Nuevo pedido', [`${t.solicitante.nombre} registró un pedido de la categoría «${t.categoriaNombre}».`]);
    case 'ticket_asignado':
      if (!staff || t.asignado?.id !== u.id) return null;
      return armar('Pedido asignado', ['Se le asignó el siguiente pedido.']);
    case 'estado_cambiado':
      return armar('Cambio de estado', [
        `El pedido ${t.codigo} pasó de «${estado(trabajo.de)}» a «${estado(trabajo.a)}».`,
      ]);
    case 'ticket_resuelto':
      // Si se reabrió antes de enviar, el aviso ya no corresponde.
      if (t.estado !== 'resuelto' && t.estado !== 'cerrado') return null;
      return armar(
        'Pedido resuelto',
        [
          `El pedido ${t.codigo} figura como resuelto. Por favor, califique la atención recibida.`,
          'Si el problema persiste, puede reabrirlo desde la misma pantalla.',
        ],
        { boton: { texto: 'Calificar la atención', url: `${url}?calificar=1` } },
      );
    case 'mensajes': {
      const nuevos = await sinLeer(db, t.id, u.id, trabajo.desde);
      if (!nuevos.length) return null;
      const omitidos = Math.max(0, nuevos.length - MAX_CITAS);
      return armar(
        nuevos.length === 1 ? 'Mensaje nuevo' : `${nuevos.length} mensajes nuevos`,
        [
          `Tiene ${nuevos.length === 1 ? 'un mensaje sin leer' : `${nuevos.length} mensajes sin leer`} en el pedido ${t.codigo}.`,
          ...(omitidos ? [`Se muestran los ${MAX_CITAS} más recientes.`] : []),
        ],
        {
          datos: [
            ['Pedido', t.codigo],
            ['Título', t.titulo],
          ],
          citas: nuevos.slice(-MAX_CITAS).map((m) => ({
            autor: m.autor,
            fecha: formatearFechaHora(m.creadoAt),
            texto: extracto(m.cuerpo, 400),
          })),
          boton: { texto: 'Responder', url },
        },
      );
    }
    case 'sla': {
      if (!staff || !['nuevo', 'asignado', 'en_curso'].includes(t.estado)) return null;
      const respuesta = trabajo.claseSla === 'respuesta';
      if (respuesta && t.primeraRespuestaAt) return null;
      const vence = respuesta ? t.venceRespuestaAt : t.venceResolucionAt;
      const plazo = respuesta ? 'primera respuesta' : 'resolución';
      const vencido = trabajo.nivel === 'vencido';
      return armar(vencido ? 'Plazo vencido' : 'Plazo por vencer', [
        vencido
          ? `Venció el plazo de ${plazo} del pedido ${t.codigo}.`
          : `Está por vencer el plazo de ${plazo} del pedido ${t.codigo}.`,
        ...(vence ? [`Fecha límite: ${formatearFechaHora(vence)}.`] : []),
      ]);
    }
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Genera el token de un solo uso (en la base queda solo su hash) y envía el enlace. */
async function recuperacion({ db, transporte, appUrl }: DepsMail, id: string): Promise<ResultadoMail> {
  const vigente = and(
    eq(recuperacionesPassword.id, id),
    isNull(recuperacionesPassword.usadoAt),
    gt(recuperacionesPassword.expiraAt, new Date()),
  );
  const [r] = await db.select().from(recuperacionesPassword).where(vigente);
  if (!r) return 'sin_efecto';
  const u = await usuarioActivo(db, r.usuarioId);
  if (!u) return 'sin_efecto';
  const token = randomBytes(32).toString('base64url');
  const guardado = await db
    .update(recuperacionesPassword)
    .set({ tokenHash: hashToken(token) })
    .where(vigente)
    .returning({ id: recuperacionesPassword.id });
  if (!guardado.length) return 'sin_efecto';
  return transporte.enviar(
    u.email,
    renderizar({
      asunto: `${NOMBRE_SISTEMA}: restablezca su contraseña`,
      titulo: 'Restablecer la contraseña',
      nombre: u.nombre,
      parrafos: ['Recibimos un pedido para restablecer la contraseña de su cuenta.'],
      boton: { texto: 'Elegir una contraseña nueva', url: `${appUrl}/restablecer?token=${token}` },
      nota: `El enlace se puede usar una sola vez y vence el ${formatearFechaHora(r.expiraAt)}. Si usted no hizo el pedido, ignore este mensaje: su contraseña no cambia.`,
    }),
  );
}

export async function procesarTrabajoMail(deps: DepsMail, trabajo: TrabajoMail): Promise<ResultadoMail> {
  if (trabajo.clase === 'recuperar_password') return recuperacion(deps, trabajo.recuperacionId);
  const armado = await contenidoTicket(deps, trabajo);
  if (!armado) return 'sin_efecto';
  return deps.transporte.enviar(armado.para, renderizar(armado.contenido));
}
