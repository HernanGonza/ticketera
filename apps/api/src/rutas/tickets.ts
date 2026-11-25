import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  esStaff,
  estadoAlReabrir,
  ETIQUETA_ESTADO,
  ETIQUETA_PRIORIDAD,
  formatearFechaHora,
} from '@eco/shared/dominio';
import {
  zAccionMasiva,
  zActualizarTicket,
  zCalificar,
  zCrearTicket,
  zFiltroTickets,
  zKanban,
  zMoverTicket,
  zPaginaTickets,
  zReabrir,
  zResultadoMasivo,
  zTicketDetalle,
  zTicketEvento,
  zTicketResumen,
  type TicketResumen,
} from '@eco/shared/schemas';
import { exigirSesion, exigirStaff, usuarioDe } from '../auth/guardas';
import {
  actualizarTicket,
  calificarTicket,
  crearTicket,
  leerConfiguracion,
  listarEventos,
  listarKanban,
  listarTickets,
  obtenerTicketDetalle,
  obtenerTicketResumen,
} from '../db';
import { ErrorHttp, noEncontrado } from '../errores';
import { limpiarError } from '../log';
import { aCsv } from './csv';
import { CON_SESION, respuestas, ticketEditable, ticketVisible, zRefTicket } from './comun';

const MAX_EXPORTAR = 20_000;

function filaCsv(t: TicketResumen) {
  const fecha = (f: string | null) => (f ? formatearFechaHora(f) : '');
  return [
    t.codigo,
    t.titulo,
    ETIQUETA_ESTADO[t.estado],
    ETIQUETA_PRIORIDAD[t.prioridad],
    t.categoriaNombre,
    t.areaNombre ?? '',
    t.solicitante.nombre,
    t.asignado?.nombre ?? '',
    fecha(t.creadoAt),
    fecha(t.actualizadoAt),
    fecha(t.primeraRespuestaAt),
    fecha(t.resueltoAt),
    fecha(t.venceResolucionAt),
  ];
}
const COLUMNAS_CSV = [
  'Código',
  'Título',
  'Estado',
  'Prioridad',
  'Categoría',
  'Área',
  'Solicitante',
  'Asignado',
  'Creado',
  'Actualizado',
  'Primera respuesta',
  'Resuelto',
  'Vence resolución',
];

export const rutasTickets: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps.conexion;
  const tags = ['tickets'];
  const sesion = { tags, security: CON_SESION };

  const detalle = async (id: string, incluirInternos: boolean) => {
    const t = await obtenerTicketDetalle(db, id, { incluirInternos });
    if (!t) throw noEncontrado('El ticket');
    return t;
  };

  app.get(
    '/api/tickets',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, querystring: zFiltroTickets, response: respuestas(zPaginaTickets) },
    },
    async (req) => listarTickets(db, req.query, usuarioDe(req), await leerConfiguracion(db)),
  );

  app.post(
    '/api/tickets',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, body: zCrearTicket, response: respuestas(zTicketDetalle, 201) },
    },
    async (req, reply) => {
      const u = usuarioDe(req);
      const id = await crearTicket(db, req.body, u.id);
      return reply.status(201).send(await detalle(id, esStaff(u)));
    },
  );

  app.get(
    '/api/tickets/exportar.csv',
    {
      onRequest: exigirStaff,
      schema: {
        ...sesion,
        summary: 'CSV (UTF-8 con BOM, separado por punto y coma)',
        querystring: zFiltroTickets,
        response: { ...respuestas(z.string()) },
      },
    },
    async (req, reply) => {
      const u = usuarioDe(req);
      const config = await leerConfiguracion(db);
      const filas: string[][] = [];
      const ahora = new Date();
      for (let pagina = 1; filas.length < MAX_EXPORTAR; pagina++) {
        const { items, total } = await listarTickets(db, { ...req.query, pagina, porPagina: 500 }, u, config, ahora);
        filas.push(...items.map(filaCsv));
        if (!items.length || filas.length >= total) break;
      }
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="pedidos-${ahora.toISOString().slice(0, 10)}.csv"`)
        .send(aCsv([COLUMNAS_CSV, ...filas]));
    },
  );

  app.post(
    '/api/tickets/masivo',
    {
      onRequest: exigirStaff,
      schema: { ...sesion, body: zAccionMasiva, response: respuestas(zResultadoMasivo) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const actualizados: string[] = [];
      const errores: { id: string; mensaje: string }[] = [];
      // Cada ticket en su transacción: uno que falla no frena al resto.
      for (const id of new Set(req.body.ids)) {
        try {
          await actualizarTicket(db, id, req.body.cambios, u);
          actualizados.push(id);
        } catch (e) {
          if (!(e instanceof ErrorHttp)) req.log.error({ err: limpiarError(e) }, 'Falló una acción masiva');
          errores.push({ id, mensaje: e instanceof ErrorHttp ? e.message : 'No se pudo actualizar.' });
        }
      }
      return { actualizados, errores };
    },
  );

  app.get(
    '/api/kanban',
    { onRequest: exigirStaff, schema: { ...sesion, response: respuestas(zKanban) } },
    async () => ({ tickets: await listarKanban(db) }),
  );

  app.get(
    '/api/tickets/:id',
    { onRequest: exigirSesion, schema: { ...sesion, params: zRefTicket, response: respuestas(zTicketDetalle) } },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketVisible(db, req.params.id, u);
      return detalle(t.id, esStaff(u));
    },
  );

  app.patch(
    '/api/tickets/:id',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, params: zRefTicket, body: zActualizarTicket, response: respuestas(zTicketDetalle) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketEditable(db, req.params.id, u);
      const { version, ...cambios } = req.body;
      await actualizarTicket(db, t.id, cambios, u, { version });
      return detalle(t.id, esStaff(u));
    },
  );

  app.patch(
    '/api/tickets/:id/mover',
    {
      onRequest: exigirStaff,
      schema: { ...sesion, params: zRefTicket, body: zMoverTicket, response: respuestas(zTicketResumen) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketVisible(db, req.params.id, u);
      const { version, estado, antesDeId, despuesDeId } = req.body;
      await actualizarTicket(db, t.id, { estado, posicion: { antesDeId, despuesDeId } }, u, { version });
      return (await obtenerTicketResumen(db, t.id))!;
    },
  );

  app.post(
    '/api/tickets/:id/reabrir',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, params: zRefTicket, body: zReabrir, response: respuestas(zTicketDetalle) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketEditable(db, req.params.id, u);
      const actual = (await obtenerTicketResumen(db, t.id))!;
      const { version, motivo } = req.body;
      if (actual.estado !== 'resuelto')
        throw new ErrorHttp(
          409,
          version === actual.version ? 'transicion_invalida' : 'conflicto_version',
          'Solo se puede reabrir un pedido resuelto.',
          { ticket: actual },
        );
      await actualizarTicket(db, t.id, { estado: estadoAlReabrir(actual.asignado !== null) }, u, { version, motivo });
      return detalle(t.id, esStaff(u));
    },
  );

  app.post(
    '/api/tickets/:id/calificar',
    {
      onRequest: exigirSesion,
      schema: { ...sesion, params: zRefTicket, body: zCalificar, response: respuestas(zTicketDetalle) },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketVisible(db, req.params.id, u);
      await calificarTicket(db, t.id, req.body, u);
      return detalle(t.id, esStaff(u));
    },
  );

  app.get(
    '/api/tickets/:id/eventos',
    {
      onRequest: exigirSesion,
      schema: {
        ...sesion,
        params: zRefTicket,
        response: respuestas(z.object({ items: z.array(zTicketEvento) })),
      },
    },
    async (req) => {
      const u = usuarioDe(req);
      const t = await ticketVisible(db, req.params.id, u);
      return { items: await listarEventos(db, t.id, { incluirSla: esStaff(u) }) };
    },
  );
};
