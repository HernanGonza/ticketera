/** Ciclo de vida del ticket: alta, cambios de gestión, orden del kanban, calificación y asignación automática. */
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
import {
  esStaff,
  ETIQUETA_ESTADO,
  minutosHabilesEntre,
  puedeTransicionar,
  puedeVerTicket,
  requiereAsignado,
  sumarHorasEnDiasHabiles,
  sumarMinutosHabiles,
  TRANSICIONES,
  type Estado,
  type Prioridad,
  type TipoEvento,
  type UsuarioSesion,
} from '@eco/shared/dominio';
import type { CambiosTicket } from '@eco/shared/eventos';
import type { CampoExtra } from '@eco/shared/schemas';
import { ErrorHttp, noEncontrado, sinPermiso } from '../errores';
import type { Ejecutor, Tx } from './conexion';
import { leerConfiguracion } from './configuracion';
import { esUuid, obtenerTicketResumen } from './consultas';
import { emitirEvento } from './eventos';
import { categorias, ticketEventos, tickets, usuarios, type TicketFila } from './schema';

/** Claves de advisory locks (de transacción). */
const BLOQUEO_KANBAN = 7_316_002;
const BLOQUEO_ASIGNACION = 7_316_003;
const PASO_ORDEN = 1024;
const PRECISION_MINIMA = 1e-6;

const invalido = (mensaje: string, detalles?: unknown) => new ErrorHttp(400, 'validacion', mensaje, detalles);

const bloquear = (tx: Tx, clave: number) => tx.execute(sql`select pg_advisory_xact_lock(${clave})`);

/** Fila del ticket bloqueada hasta el fin de la transacción, o 404. */
export async function bloquearTicket(tx: Tx, ticketId: string): Promise<TicketFila> {
  if (!esUuid(ticketId)) throw noEncontrado('El ticket');
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
  if (!t) throw noEncontrado('El ticket');
  return t;
}

/** Quien no puede escribir recibe 403 si puede ver el ticket y 404 si es ajeno. */
export async function exigirEscritura(
  tx: Tx,
  ticket: Pick<TicketFila, 'solicitanteId' | 'areaId'>,
  actor: UsuarioSesion,
): Promise<void> {
  if (esStaff(actor) || ticket.solicitanteId === actor.id) return;
  const { solicitanteVeArea } = await leerConfiguracion(tx);
  throw puedeVerTicket(actor, ticket, { solicitanteVeArea }) ? sinPermiso() : noEncontrado('El ticket');
}

export async function registrarEvento(
  tx: Tx,
  ticketId: string,
  tipo: TipoEvento,
  de: string | null,
  a: string | null,
  usuarioId: string | null,
  fecha: Date,
): Promise<void> {
  await tx.insert(ticketEventos).values({ ticketId, tipo, de, a, usuarioId, fecha });
}

// ---------------------------------------------------------------------------------------------
// Campos extra por categoría
// ---------------------------------------------------------------------------------------------

/**
 * Valida y normaliza los datos del formulario dinámico. Descarta claves no definidas y vacías.
 * Error: 400 `validacion` con `detalles.campos` = { clave: mensaje }.
 */
export function validarDatosCategoria(
  campos: readonly CampoExtra[],
  datos: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const limpios: Record<string, string | number | boolean> = {};
  const errores: Record<string, string> = {};
  for (const c of campos) {
    const crudo = Object.hasOwn(datos, c.clave) ? datos[c.clave] : undefined;
    const v = typeof crudo === 'string' ? crudo.trim() : crudo;
    if (v === undefined || v === null || v === '') {
      if (c.requerido) errores[c.clave] = `Complete el campo «${c.etiqueta}».`;
      continue;
    }
    const mal = (mensaje: string) => (errores[c.clave] = `«${c.etiqueta}»: ${mensaje}`);
    switch (c.tipo) {
      case 'texto':
      case 'texto_largo':
        if (typeof v !== 'string' || v.length > 2000) mal('ingrese un texto de hasta 2000 caracteres.');
        else limpios[c.clave] = v;
        break;
      case 'numero': {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
        if (!Number.isFinite(n)) mal('ingrese un número.');
        else limpios[c.clave] = n;
        break;
      }
      case 'casilla':
        if (v === true || v === 'true') limpios[c.clave] = true;
        else if (v === false || v === 'false') limpios[c.clave] = false;
        else mal('valor no válido.');
        break;
      case 'seleccion':
        if (typeof v !== 'string' || !c.opciones?.includes(v)) mal('elija una de las opciones.');
        else limpios[c.clave] = v;
        break;
      case 'fecha': {
        const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
        if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) mal('ingrese una fecha válida.');
        else limpios[c.clave] = v as string;
        break;
      }
    }
  }
  if (Object.keys(errores).length)
    throw invalido(Object.values(errores).join(' '), { campos: errores });
  return limpios;
}

// ---------------------------------------------------------------------------------------------
// Orden del kanban
// ---------------------------------------------------------------------------------------------

/** Posición para un ticket que entra al principio de una columna. */
async function ordenAlPrincipio(tx: Tx, columna: Estado, excluirId?: string): Promise<number> {
  const [r] = await tx
    .select({ minimo: sql<string | null>`min(${tickets.ordenKanban})` })
    .from(tickets)
    .where(and(eq(tickets.estado, columna), excluirId ? ne(tickets.id, excluirId) : undefined));
  return r?.minimo == null ? 0 : Number(r.minimo) - PASO_ORDEN;
}

export interface Posicion {
  /** Tarjeta que queda inmediatamente debajo. */
  antesDeId?: string | null;
  /** Tarjeta que queda inmediatamente arriba. */
  despuesDeId?: string | null;
}

/** Renumera la columna conservando el orden visible y avisa de las tarjetas movidas. */
async function rebalancear(tx: Tx, columna: Estado, excluirId: string, actorId: string | null): Promise<void> {
  const filas = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.estado, columna), ne(tickets.id, excluirId)))
    .orderBy(asc(tickets.ordenKanban), desc(tickets.creadoAt), asc(tickets.id));
  const ids = filas.map((f) => f.id);
  const movidas = await tx.execute<{ id: string; reciente: boolean }>(sql`
    update tickets t set orden_kanban = v.n * ${sql.raw(String(PASO_ORDEN))}
    from unnest(${sql.param(ids)}::uuid[]) with ordinality as v(id, n)
    where t.id = v.id and t.orden_kanban is distinct from v.n * ${sql.raw(String(PASO_ORDEN))}
    returning t.id, (t.estado <> 'cerrado' or t.cerrado_at > now() - interval '7 days') as reciente`);
  for (const f of movidas.rows)
    if (f.reciente) await emitirEvento(tx, 'ticket.actualizado', { ticketId: f.id, actorId, cambios: { orden: true } });
}

/** Nuevo `orden_kanban` para respetar la posición pedida, o null si la tarjeta ya está ahí. */
async function calcularOrden(
  tx: Tx,
  columna: Estado,
  ticket: Pick<TicketFila, 'id' | 'estado' | 'ordenKanban'>,
  posicion: Posicion,
  actorId: string | null,
): Promise<number | null> {
  const enColumna = async (id: string | null | undefined) => {
    if (!id || !esUuid(id) || id === ticket.id) return null;
    const [f] = await tx
      .select({ id: tickets.id, orden: tickets.ordenKanban })
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.estado, columna)));
    return f ?? null;
  };
  const extremo = async (funcion: 'min' | 'max', ...condiciones: ReturnType<typeof eq>[]) => {
    const [r] = await tx
      .select({ v: sql<string | null>`${sql.raw(funcion)}(${tickets.ordenKanban})` })
      .from(tickets)
      .where(and(eq(tickets.estado, columna), ne(tickets.id, ticket.id), ...condiciones));
    return r?.v == null ? null : Number(r.v);
  };
  /** Intervalo abierto (arriba, abajo) donde debe quedar la tarjeta. Los vecinos fuera de la columna se ignoran. */
  const limites = async (): Promise<[number | null, number | null]> => {
    const debajo = await enColumna(posicion.antesDeId);
    if (debajo)
      return [
        await extremo('max', lte(tickets.ordenKanban, debajo.orden), ne(tickets.id, debajo.id)),
        debajo.orden,
      ];
    const arriba = await enColumna(posicion.despuesDeId);
    if (arriba)
      return [arriba.orden, await extremo('min', gte(tickets.ordenKanban, arriba.orden), ne(tickets.id, arriba.id))];
    return [null, await extremo('min')];
  };

  let [lo, hi] = await limites();
  const yaEsta = (a: number | null, b: number | null) =>
    ticket.estado === columna && (a === null || ticket.ordenKanban > a) && (b === null || ticket.ordenKanban < b);
  if (yaEsta(lo, hi)) return null;
  if (lo !== null && hi !== null && hi - lo < PRECISION_MINIMA) {
    await rebalancear(tx, columna, ticket.id, actorId);
    [lo, hi] = await limites();
  }
  if (lo !== null && hi !== null) return (lo + hi) / 2;
  if (lo !== null) return lo + PASO_ORDEN;
  if (hi !== null) return hi - PASO_ORDEN;
  return ticket.estado === columna ? null : 0;
}

// ---------------------------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------------------------

export interface DatosNuevoTicket {
  categoriaId: number;
  titulo: string;
  descripcion: string;
  ubicacion?: string | null;
  datos?: Record<string, unknown>;
}

/** Crea el pedido en estado `nuevo`, al principio de la columna. Devuelve su id. */
export async function crearTicket(
  db: Ejecutor,
  datos: DatosNuevoTicket,
  solicitanteId: string,
  ahora?: Date,
): Promise<string> {
  return db.transaction(async (tx) => {
    const fecha = ahora ?? new Date();
    const [solicitante] = await tx
      .select({ areaId: usuarios.areaId })
      .from(usuarios)
      .where(and(eq(usuarios.id, solicitanteId), eq(usuarios.activo, true)));
    if (!solicitante) throw invalido('El solicitante no existe o está inactivo.');
    const [categoria] = await tx.select().from(categorias).where(eq(categorias.id, datos.categoriaId));
    if (!categoria?.activa)
      throw invalido('La categoría elegida no está disponible.', {
        campos: { categoriaId: 'Categoría no disponible.' },
      });
    const extra = validarDatosCategoria(categoria.campos, datos.datos ?? {});
    const { calendario } = await leerConfiguracion(tx);
    const [fila] = await tx
      .insert(tickets)
      .values({
        titulo: datos.titulo.trim(),
        descripcion: datos.descripcion.trim(),
        categoriaId: categoria.id,
        prioridad: categoria.prioridadDefault,
        solicitanteId,
        areaId: solicitante.areaId,
        ubicacion: datos.ubicacion?.trim() || null,
        datos: extra,
        ordenKanban: await ordenAlPrincipio(tx, 'nuevo'),
        creadoAt: fecha,
        actualizadoAt: fecha,
        slaRespuestaMin: categoria.slaRespuestaMin,
        slaResolucionMin: categoria.slaResolucionMin,
        venceRespuestaAt: sumarMinutosHabiles(fecha, categoria.slaRespuestaMin, calendario),
        venceResolucionAt: sumarMinutosHabiles(fecha, categoria.slaResolucionMin, calendario),
      })
      .returning({ id: tickets.id });
    const id = fila!.id;
    await registrarEvento(tx, id, 'creado', null, 'nuevo', solicitanteId, fecha);
    await emitirEvento(tx, 'ticket.creado', { ticketId: id, actorId: solicitanteId });
    return id;
  });
}

// ---------------------------------------------------------------------------------------------
// Cambios
// ---------------------------------------------------------------------------------------------

export interface CambiosPedidos {
  estado?: Estado;
  prioridad?: Prioridad;
  categoriaId?: number;
  /** `null` desasigna. */
  asignadoId?: string | null;
  /** Reordenar en la columna destino (solo staff). Sin vecinos: al principio. */
  posicion?: Posicion;
}

export interface OpcionesActualizacion {
  /** Control optimista: si no coincide, 409 `conflicto_version` con `detalles.ticket`. */
  version?: number;
  ahora?: Date;
  /** Motivo de la reapertura (queda en el evento `reabierto`). */
  motivo?: string;
}

export interface ResultadoActualizacion {
  id: string;
  /** Versión resultante (sin cambios: la actual). */
  version: number;
  /** null = no hubo cambios reales y no se escribió nada. Es lo mismo que viaja en el outbox. */
  cambios: CambiosTicket | null;
}

/**
 * Aplica cambios de gestión o de estado. `actor` null = sistema (admite cualquier transición de `TRANSICIONES`).
 * Errores: 404 ticket ajeno, 403 sin permiso, 409 `conflicto_version` / `transicion_invalida`, 400 `validacion`.
 */
export async function actualizarTicket(
  db: Ejecutor,
  ticketId: string,
  cambios: CambiosPedidos,
  actor: UsuarioSesion | null,
  opciones: OpcionesActualizacion = {},
): Promise<ResultadoActualizacion> {
  return db.transaction(async (tx) => {
    // El bloqueo de orden se toma antes que el de la fila para que un rebalanceo no genere interbloqueos.
    if (cambios.estado !== undefined || cambios.asignadoId !== undefined || cambios.posicion)
      await bloquear(tx, BLOQUEO_KANBAN);
    const t = await bloquearTicket(tx, ticketId);
    const ahora = opciones.ahora ?? new Date();
    const actorId = actor?.id ?? null;
    const staff = actor !== null && esStaff(actor);

    if (actor && !staff) {
      await exigirEscritura(tx, t, actor);
      const deGestion =
        (cambios.prioridad !== undefined && cambios.prioridad !== t.prioridad) ||
        (cambios.categoriaId !== undefined && cambios.categoriaId !== t.categoriaId) ||
        (cambios.asignadoId !== undefined && cambios.asignadoId !== t.asignadoId) ||
        cambios.posicion !== undefined;
      if (deGestion) throw sinPermiso();
    }

    const conflicto = async (codigo: 'conflicto_version' | 'transicion_invalida', mensaje: string) =>
      new ErrorHttp(409, codigo, mensaje, { ticket: await obtenerTicketResumen(tx, t.id) });
    if (opciones.version !== undefined && opciones.version !== t.version)
      throw await conflicto('conflicto_version', 'Otro usuario modificó este ticket. Revise los datos actualizados.');

    // Estado y técnico resultantes.
    const explicito = cambios.estado !== undefined && cambios.estado !== t.estado ? cambios.estado : undefined;
    let estado: Estado = explicito ?? t.estado;
    let asignado = cambios.asignadoId !== undefined ? cambios.asignadoId : t.asignadoId;
    if (explicito) {
      const permitido = actor
        ? puedeTransicionar(t.estado, explicito, {
            rol: actor.rol,
            esSolicitante: t.solicitanteId === actor.id,
            tieneAsignado: t.asignadoId !== null,
          })
        : TRANSICIONES[t.estado].includes(explicito);
      if (!permitido)
        throw await conflicto(
          'transicion_invalida',
          `No es posible pasar de «${ETIQUETA_ESTADO[t.estado]}» a «${ETIQUETA_ESTADO[explicito]}».`,
        );
      if (explicito === 'nuevo') {
        if (cambios.asignadoId) throw invalido('Un ticket nuevo no puede tener técnico asignado.');
        asignado = null;
      } else if (requiereAsignado(explicito) && !asignado) {
        if (cambios.asignadoId === null || !staff)
          throw await conflicto('transicion_invalida', 'Ese estado requiere un técnico asignado.');
        asignado = actor.id;
      }
    } else if (asignado !== t.asignadoId) {
      if (t.estado === 'nuevo' && asignado) estado = 'asignado';
      else if (!asignado && t.estado === 'asignado') estado = 'nuevo';
      else if (!asignado && requiereAsignado(t.estado))
        throw await conflicto(
          'transicion_invalida',
          `Un ticket «${ETIQUETA_ESTADO[t.estado]}» no puede quedar sin técnico asignado.`,
        );
    }

    if (asignado && asignado !== t.asignadoId) {
      const [tecnico] = esUuid(asignado)
        ? await tx
            .select({ id: usuarios.id })
            .from(usuarios)
            .where(
              and(eq(usuarios.id, asignado), eq(usuarios.activo, true), inArray(usuarios.rol, ['tecnico', 'admin'])),
            )
        : [];
      if (!tecnico)
        throw invalido('El técnico indicado no está disponible.', { campos: { asignadoId: 'No disponible.' } });
    }

    const prioridad = cambios.prioridad ?? t.prioridad;
    const categoriaId = cambios.categoriaId ?? t.categoriaId;
    let categoriaNueva: typeof categorias.$inferSelect | undefined;
    if (categoriaId !== t.categoriaId) {
      [categoriaNueva] = await tx.select().from(categorias).where(eq(categorias.id, categoriaId));
      if (!categoriaNueva?.activa)
        throw invalido('La categoría elegida no está disponible.', {
          campos: { categoriaId: 'Categoría no disponible.' },
        });
    }

    let orden: number | null = null;
    if (cambios.posicion) orden = await calcularOrden(tx, estado, t, cambios.posicion, actorId);
    else if (estado !== t.estado) orden = await ordenAlPrincipio(tx, estado, t.id);

    const registro: CambiosTicket = {};
    if (estado !== t.estado) registro.estado = { de: t.estado, a: estado };
    if (prioridad !== t.prioridad) registro.prioridad = { de: t.prioridad, a: prioridad };
    if (asignado !== t.asignadoId) registro.asignado = { de: t.asignadoId, a: asignado };
    if (categoriaId !== t.categoriaId) registro.categoria = { de: t.categoriaId, a: categoriaId };
    if (cambios.posicion && orden !== null) registro.orden = true;
    if (!Object.keys(registro).length) return { id: t.id, version: t.version, cambios: null };

    const version = t.version + 1;
    const parche: Partial<typeof tickets.$inferInsert> = {
      estado,
      prioridad,
      asignadoId: asignado,
      categoriaId,
      version,
    };
    if (orden !== null) parche.ordenKanban = orden;
    // Reordenar tarjetas no cuenta como actividad del ticket.
    if (Object.keys(registro).some((k) => k !== 'orden')) parche.actualizadoAt = ahora;

    const reabre = t.estado === 'resuelto' && (estado === 'en_curso' || estado === 'nuevo');
    if (estado !== t.estado || categoriaNueva) {
      const config = await leerConfiguracion(tx);
      const cal = config.calendario;
      let espera = t.minutosEnEspera;
      let venceRespuesta = t.venceRespuestaAt;
      let venceResolucion = t.venceResolucionAt;
      /** El reloj estuvo detenido desde `desde`: se descuenta y se corren los vencimientos. */
      const descontar = (desde: Date | null) => {
        const minutos = desde ? minutosHabilesEntre(desde, ahora, cal) : 0;
        if (!minutos) return;
        espera += minutos;
        if (venceResolucion) venceResolucion = sumarMinutosHabiles(venceResolucion, minutos, cal);
        if (venceRespuesta && !t.primeraRespuestaAt)
          venceRespuesta = sumarMinutosHabiles(venceRespuesta, minutos, cal);
      };
      if (estado !== t.estado) {
        if (t.estado === 'en_espera') {
          descontar(t.enEsperaDesde);
          parche.enEsperaDesde = null;
        }
        if (reabre) descontar(t.resueltoAt);
      }
      if (categoriaNueva) {
        parche.slaRespuestaMin = categoriaNueva.slaRespuestaMin;
        parche.slaResolucionMin = categoriaNueva.slaResolucionMin;
        venceRespuesta = sumarMinutosHabiles(
          t.creadoAt,
          categoriaNueva.slaRespuestaMin + (t.primeraRespuestaAt ? 0 : espera),
          cal,
        );
        venceResolucion = sumarMinutosHabiles(t.creadoAt, categoriaNueva.slaResolucionMin + espera, cal);
        parche.alertasSla = [];
      }
      parche.minutosEnEspera = espera;
      parche.venceRespuestaAt = venceRespuesta;
      parche.venceResolucionAt = venceResolucion;

      if (estado !== t.estado) {
        if (estado === 'en_espera') parche.enEsperaDesde = ahora;
        if (estado === 'resuelto') {
          parche.resueltoAt = ahora;
          parche.minResolucion = Math.max(0, minutosHabilesEntre(t.creadoAt, ahora, cal) - espera);
          parche.autocierreAt = sumarHorasEnDiasHabiles(ahora, config.horasAutocierre, cal);
        }
        if (estado === 'cerrado' || estado === 'cancelado') {
          parche.cerradoAt = ahora;
          parche.autocierreAt = null;
        }
        if (reabre) {
          parche.reabierto = t.reabierto + 1;
          parche.resueltoAt = null;
          parche.minResolucion = null;
          parche.autocierreAt = null;
          parche.calificacion = null;
          parche.comentarioCalificacion = null;
        }
      }
    }

    await tx.update(tickets).set(parche).where(eq(tickets.id, t.id));

    const evento = (tipo: TipoEvento, de: string | null, a: string | null) =>
      registrarEvento(tx, t.id, tipo, de, a, actorId, ahora);
    if (registro.categoria) await evento('categoria', String(t.categoriaId), String(categoriaId));
    if (registro.prioridad) await evento('prioridad', t.prioridad, prioridad);
    if (registro.asignado) await evento('asignacion', t.asignadoId, asignado);
    if (registro.estado) await evento('estado', t.estado, estado);
    if (reabre) await evento('reabierto', t.estado, opciones.motivo?.trim() || null);

    await emitirEvento(tx, 'ticket.actualizado', { ticketId: t.id, actorId, cambios: registro });
    return { id: t.id, version, cambios: registro };
  });
}

// ---------------------------------------------------------------------------------------------
// Calificación y asignación automática
// ---------------------------------------------------------------------------------------------

/**
 * Solo el solicitante, con el ticket resuelto o cerrado. Puede corregirse mientras siga resuelto.
 * No incrementa `version`.
 */
export async function calificarTicket(
  db: Ejecutor,
  ticketId: string,
  datos: { calificacion: number; comentario?: string | null },
  actor: UsuarioSesion,
  ahora?: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await bloquearTicket(tx, ticketId);
    if (t.solicitanteId !== actor.id) {
      const { solicitanteVeArea } = await leerConfiguracion(tx);
      throw puedeVerTicket(actor, t, { solicitanteVeArea }) ? sinPermiso() : noEncontrado('El ticket');
    }
    if (!Number.isInteger(datos.calificacion) || datos.calificacion < 1 || datos.calificacion > 5)
      throw invalido('La calificación va de 1 a 5.');
    if (t.estado !== 'resuelto' && t.estado !== 'cerrado')
      throw new ErrorHttp(409, 'conflicto', 'Solo se puede calificar un pedido resuelto.');
    if (t.estado === 'cerrado' && t.calificacion !== null)
      throw new ErrorHttp(409, 'conflicto', 'Este pedido ya fue calificado.');
    const comentario = datos.comentario?.trim() || null;
    if (t.calificacion === datos.calificacion && t.comentarioCalificacion === comentario) return;
    const fecha = ahora ?? new Date();
    await tx
      .update(tickets)
      .set({ calificacion: datos.calificacion, comentarioCalificacion: comentario, actualizadoAt: fecha })
      .where(eq(tickets.id, t.id));
    await registrarEvento(
      tx,
      t.id,
      'calificacion',
      t.calificacion === null ? null : String(t.calificacion),
      String(datos.calificacion),
      actor.id,
      fecha,
    );
    await emitirEvento(tx, 'ticket.actualizado', {
      ticketId: t.id,
      actorId: actor.id,
      cambios: { calificacion: true },
    });
  });
}

/**
 * Asigna según la categoría: técnico fijo, o round-robin al técnico con menor carga abierta
 * (a igualdad, el que hace más que no recibe uno). Solo si sigue `nuevo` y sin asignar.
 * Devuelve el id del técnico o null si no correspondía.
 */
export async function autoasignar(db: Ejecutor, ticketId: string, ahora?: Date): Promise<string | null> {
  if (!esUuid(ticketId)) return null;
  return db.transaction(async (tx) => {
    await bloquear(tx, BLOQUEO_KANBAN);
    await bloquear(tx, BLOQUEO_ASIGNACION);
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
    if (!t || t.estado !== 'nuevo' || t.asignadoId) return null;
    const [c] = await tx.select().from(categorias).where(eq(categorias.id, t.categoriaId));
    if (!c || c.modoAsignacion === 'manual') return null;

    let tecnicoId: string | undefined;
    if (c.modoAsignacion === 'fija') {
      if (!c.tecnicoDefaultId) return null;
      const [u] = await tx
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(
          and(
            eq(usuarios.id, c.tecnicoDefaultId),
            eq(usuarios.activo, true),
            notInArray(usuarios.rol, ['solicitante']),
          ),
        );
      tecnicoId = u?.id;
    } else {
      const r = await tx.execute<{ id: string }>(sql`
        select u.id from usuarios u
        where u.rol = 'tecnico' and u.activo and u.id <> ${t.solicitanteId}
        order by
          (select count(*) from tickets x where x.asignado_id = u.id
             and x.estado in ('nuevo','asignado','en_curso','en_espera')),
          (select max(e.fecha) from ticket_eventos e where e.tipo = 'asignacion' and e.a = u.id::text) nulls first,
          u.nombre, u.id
        limit 1`);
      tecnicoId = r.rows[0]?.id;
    }
    if (!tecnicoId) return null;
    await actualizarTicket(tx, t.id, { asignadoId: tecnicoId }, null, { ahora });
    return tecnicoId;
  });
}
