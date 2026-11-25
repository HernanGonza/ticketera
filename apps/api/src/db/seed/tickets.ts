/**
 * Genera pedidos de demostración con historial, mensajes y métricas coherentes entre sí.
 * Inserta en bloque y **no** escribe en el outbox: los datos sembrados no disparan mails ni avisos.
 */
import { sql } from 'drizzle-orm';
import {
  minutosHabilesEntre,
  sumarHorasEnDiasHabiles,
  sumarMinutosHabiles,
  type Calendario,
  type Estado,
  type Prioridad,
  type TipoEvento,
} from '@eco/shared/dominio';
import type { Tx } from '../conexion';
import { alertasPendientes } from '../operaciones-sistema';
import {
  lecturas,
  mensajes,
  ticketEventos,
  tickets,
  type AlertaSla,
  type CategoriaFila,
  type UsuarioFila,
} from '../schema';
import type { Azar } from './azar';
import * as txt from './textos';

export type Escenario =
  | 'historico'
  | 'cerrado_reciente'
  | 'resuelto'
  | 'cancelado'
  | 'nuevo'
  | 'asignado'
  | 'en_curso'
  | 'en_espera'
  | 'reabierto_abierto';

export interface Contexto {
  azar: Azar;
  ahora: Date;
  calendario: Calendario;
  horasAutocierre: number;
  categorias: CategoriaFila[];
  /** El primero es la cuenta principal (recibe más pedidos). */
  tecnicos: UsuarioFila[];
  solicitantes: UsuarioFila[];
  admin: UsuarioFila | undefined;
}

type FilaTicket = typeof tickets.$inferInsert & { id: string; estado: Estado; creadoAt: Date };
type FilaEvento = typeof ticketEventos.$inferInsert & { fecha: Date };
type FilaMensaje = typeof mensajes.$inferInsert & { id: string; creadoAt: Date; interno: boolean };
export interface PedidoGenerado {
  ticket: FilaTicket;
  eventos: FilaEvento[];
  mensajes: FilaMensaje[];
  lecturas: (typeof lecturas.$inferInsert)[];
}

/** Instante desde el cual hasta `fin` transcurren `minutos` hábiles. */
export function restarMinutosHabiles(fin: Date, minutos: number, cal: Calendario): Date {
  if (minutos <= 0) return fin;
  let hi = fin.getTime();
  let paso = 86_400_000;
  while (minutosHabilesEntre(new Date(hi - paso), fin, cal) < minutos && paso < 3000 * 86_400_000) paso *= 2;
  let lo = hi - paso;
  while (hi - lo > 1000) {
    const medio = Math.floor((lo + hi) / 2);
    if (minutosHabilesEntre(new Date(medio), fin, cal) >= minutos) lo = medio;
    else hi = medio;
  }
  return new Date(lo);
}

const PESO_HORA = [2, 9, 14, 13, 11, 8, 4, 5, 6, 5, 3, 1]; // 07 a 18 h

/** Fecha en horario laboral (con algún pedido ocasional fuera de horario) dentro del intervalo. */
function fechaCreacion(c: Contexto, desde: Date, hasta: Date): Date {
  const { azar } = c;
  for (let i = 0; i < 60; i++) {
    const base = new Date(azar.entre(desde.getTime(), hasta.getTime()) - 3 * 3600_000);
    const finde = base.getUTCDay() === 0 || base.getUTCDay() === 6;
    if (finde && !azar.prob(0.06)) continue;
    const hora = azar.prob(0.03)
      ? azar.entero(19, 22)
      : azar.pesado(
          PESO_HORA.map((_, h) => h + 7),
          PESO_HORA,
        );
    base.setUTCHours(hora, azar.entero(0, 59), azar.entero(0, 59), 0);
    const fecha = new Date(base.getTime() + 3 * 3600_000);
    if (fecha >= desde && fecha <= hasta) return fecha;
  }
  return desde;
}

const PESO_CATEGORIA: Record<string, number> = {
  'Internet/Red': 14,
  'Wi-Fi': 8,
  'PC no enciende': 9,
  Impresora: 18,
  Correo: 11,
  'Alta/baja de usuario': 6,
  'Sistemas del Ministerio': 13,
  'Telefonía/interno': 4,
  'Software/instalación': 8,
  'Proyector/sala': 4,
  Cámaras: 2,
  Otro: 3,
};

function datosExtra(c: Contexto, cat: CategoriaFila, creado: Date): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const campo of cat.campos) {
    if (!campo.requerido && c.azar.prob(0.35)) continue;
    r[campo.clave] =
      campo.tipo === 'seleccion'
        ? c.azar.elegir(campo.opciones ?? ['Otro'])
        : campo.tipo === 'numero'
          ? c.azar.entero(100, 399)
          : campo.tipo === 'casilla'
            ? c.azar.prob(0.5)
            : campo.tipo === 'fecha'
              ? new Date(creado.getTime() + c.azar.entero(1, 10) * 86_400_000).toISOString().slice(0, 10)
              : campo.clave === 'cuenta'
                ? c.azar.elegir(c.solicitantes).email
                : campo.clave === 'persona'
                  ? c.azar.elegir(c.solicitantes).nombre
                  : campo.clave === 'programa'
                    ? c.azar.elegir(['QGIS', 'LibreOffice', 'Lector de PDF', 'Firma digital'])
                    : `${campo.etiqueta}: INV-${c.azar.entero(1000, 9999)}`;
  }
  return r;
}

export function generarPedido(c: Contexto, escenario: Escenario): PedidoGenerado {
  const { azar, ahora, calendario: cal } = c;
  const cat = azar.pesado(
    c.categorias,
    c.categorias.map((x) => PESO_CATEGORIA[x.nombre] ?? 3),
  );
  const [titulo, descripcion, solucion] = azar.elegir(txt.PEDIDOS[cat.nombre] ?? txt.PEDIDOS.Otro!);
  // La cuenta principal de solicitante concentra algunos pedidos para que la demo tenga contenido.
  const solicitante = azar.prob(0.09) ? c.solicitantes[0]! : azar.elegir(c.solicitantes);
  const tecnico =
    c.tecnicos.find((t) => t.id === cat.tecnicoDefaultId && azar.prob(0.75)) ??
    azar.pesado(c.tecnicos, [5, 3, 3, 2, 2]);
  const prioridad: Prioridad = azar.prob(0.82)
    ? cat.prioridadDefault
    : azar.pesado<Prioridad>(['baja', 'media', 'alta', 'critica'], [2, 3, 3, 2]);
  const slaR = cat.slaRespuestaMin;
  const sla = cat.slaResolucionMin;

  const abierto = ['nuevo', 'asignado', 'en_curso', 'en_espera', 'reabierto_abierto'].includes(escenario);

  // Tiempos hábiles desde la creación.
  let respuesta = Math.round(azar.prob(0.86) ? azar.entre(0.08, 0.85) * slaR : azar.entre(1.1, 2.4) * slaR);
  const conPausa = escenario === 'en_espera' || (!abierto && azar.prob(0.18));
  let pausa = conPausa ? azar.entero(60, 900) : 0;
  let activo = Math.round(azar.prob(0.83) ? azar.entre(0.15, 0.78) * sla : azar.entre(1.05, 1.9) * sla);
  activo = Math.max(activo, respuesta + 20);
  const reabre = escenario === 'reabierto_abierto' || (escenario === 'historico' && azar.prob(0.07));
  const brecha = reabre ? azar.entero(60, 600) : 0;
  const extra = reabre ? azar.entero(30, Math.max(40, Math.round(sla * 0.3))) : 0;

  let consumido = 0;
  let creado: Date;
  if (abierto) {
    const nivel = azar.pesado(['ok', 'por_vencer', 'vencido'] as const, escenario === 'nuevo' ? [8, 1, 1] : [6, 2, 2]);
    const fraccion =
      nivel === 'ok'
        ? azar.entre(0.02, escenario === 'nuevo' ? 0.2 : 0.68)
        : nivel === 'por_vencer'
          ? azar.entre(0.83, 0.94)
          : azar.entre(1.05, 1.8);
    consumido = Math.max(5, Math.round(fraccion * sla));
    if (escenario === 'nuevo' && nivel === 'ok') consumido = azar.entero(3, Math.max(5, Math.round(slaR * 1.1)));
    respuesta = Math.min(respuesta, Math.max(2, Math.round(consumido * 0.45)));
    creado = restarMinutosHabiles(ahora, consumido + pausa + brecha, cal);
  } else if (escenario === 'resuelto') {
    const resuelto = restarMinutosHabiles(ahora, azar.entero(10, 1300), cal);
    creado = restarMinutosHabiles(resuelto, activo + pausa, cal);
  } else if (escenario === 'cerrado_reciente') {
    const cierre = restarMinutosHabiles(ahora, azar.entero(20, 2400), cal);
    creado = restarMinutosHabiles(cierre, activo + pausa + 90, cal);
  } else {
    const desde = new Date(ahora.getTime() - 90 * 86_400_000);
    creado = fechaCreacion(c, desde, restarMinutosHabiles(ahora, 6600, cal));
  }
  const en = (minutos: number) => sumarMinutosHabiles(creado, Math.max(0, minutos), cal);
  /** Ningún hecho puede quedar en el futuro. */
  const tope = (f: Date) => (f > ahora ? ahora : f);

  const id = azar.uuid();
  const eventos: FilaEvento[] = [];
  const conversacion: FilaMensaje[] = [];
  const evento = (tipo: TipoEvento, de: string | null, a: string | null, usuarioId: string | null, f: Date) =>
    eventos.push({ ticketId: id, tipo, de, a, usuarioId, fecha: tope(f) });
  const cambio = (de: Estado, a: Estado, usuarioId: string | null, f: Date) => evento('estado', de, a, usuarioId, f);
  const mensaje = (autorId: string, cuerpo: string, f: Date, interno = false) =>
    conversacion.push({ id: azar.uuid(), ticketId: id, autorId, cuerpo, interno, creadoAt: tope(f) });

  const t: FilaTicket = {
    id,
    titulo,
    descripcion,
    categoriaId: cat.id,
    prioridad,
    estado: 'nuevo',
    solicitanteId: solicitante.id,
    areaId: solicitante.areaId,
    asignadoId: null,
    ubicacion: azar.elegir(txt.UBICACIONES),
    datos: datosExtra(c, cat, creado),
    creadoAt: creado,
    slaRespuestaMin: slaR,
    slaResolucionMin: sla,
    minutosEnEspera: 0,
    reabierto: 0,
  };
  evento('creado', null, 'nuevo', solicitante.id, creado);

  /** Minutos de reloj detenido acumulados. */
  let detenido = 0;
  let responde: Date | null = null;
  const asignar = (f: Date) => {
    const quien = azar.prob(0.5) ? tecnico.id : azar.prob(0.5) ? null : (c.admin?.id ?? tecnico.id);
    t.asignadoId = tecnico.id;
    evento('asignacion', null, tecnico.id, quien, f);
    cambio('nuevo', 'asignado', quien, f);
    t.estado = 'asignado';
  };
  const responder = (f: Date) => {
    responde = tope(f);
    mensaje(tecnico.id, azar.elegir(txt.PRIMERAS_RESPUESTAS), responde);
    evento('primera_respuesta', null, null, tecnico.id, responde);
    t.primeraRespuestaAt = responde;
    t.minPrimeraRespuesta = minutosHabilesEntre(creado, responde, cal);
  };
  const empezar = (f: Date) => {
    cambio('asignado', 'en_curso', tecnico.id, f);
    t.estado = 'en_curso';
  };
  const charla = (f: Date) => {
    if (azar.prob(0.45)) mensaje(solicitante.id, azar.elegir(txt.RESPUESTAS_SOLICITANTE), f);
    if (azar.prob(0.16)) mensaje(azar.elegir(c.tecnicos).id, azar.elegir(txt.NOTAS_INTERNAS), f, true);
  };
  const pausar = (f: Date) => {
    mensaje(tecnico.id, azar.elegir(txt.MENSAJES_ESPERA), f);
    cambio('en_curso', 'en_espera', tecnico.id, f);
    t.estado = 'en_espera';
  };
  const resolver = (f: Date) => {
    const fecha = tope(f);
    mensaje(tecnico.id, solucion, fecha);
    cambio('en_curso', 'resuelto', tecnico.id, fecha);
    t.estado = 'resuelto';
    t.resueltoAt = fecha;
    return fecha;
  };
  const reabrir = (f: Date, desde: Date) => {
    const fecha = tope(f);
    detenido += minutosHabilesEntre(desde, fecha, cal);
    const motivo = azar.elegir(txt.MOTIVOS_REAPERTURA);
    mensaje(solicitante.id, motivo, fecha);
    cambio('resuelto', 'en_curso', solicitante.id, fecha);
    evento('reabierto', 'resuelto', motivo, solicitante.id, fecha);
    t.estado = 'en_curso';
    t.resueltoAt = null;
    t.reabierto = 1;
  };

  if (escenario === 'cancelado') {
    const cuando = en(azar.entero(30, 400));
    if (azar.prob(0.5)) asignar(en(azar.entero(5, 25)));
    mensaje(solicitante.id, 'Ya no es necesario, se solucionó. Muchas gracias.', cuando);
    cambio(t.estado, 'cancelado', solicitante.id, cuando);
    t.estado = 'cancelado';
    t.cerradoAt = tope(cuando);
  } else if (escenario === 'nuevo') {
    if (azar.prob(0.2)) mensaje(solicitante.id, 'Agrego que es urgente para el trabajo de hoy.', en(consumido * 0.5));
  } else if (escenario === 'asignado') {
    asignar(en(respuesta * 0.5));
    if (azar.prob(0.45)) responder(en(respuesta));
  } else {
    asignar(en(respuesta * 0.5));
    // Alguno en curso sigue sin respuesta escrita (el técnico fue en persona).
    if (!(escenario === 'en_curso' && azar.prob(0.1))) responder(en(respuesta));
    const inicio = respuesta + azar.entero(1, 15);
    empezar(en(Math.min(inicio, abierto ? consumido : inicio)));
    charla(en(abierto ? Math.min(consumido, inicio + 20) : inicio + 20));

    if (escenario === 'en_espera') {
      const desde = restarMinutosHabiles(ahora, pausa, cal);
      pausar(desde);
      t.enEsperaDesde = desde;
    } else if (escenario === 'reabierto_abierto') {
      const corte = Math.max(inicio + 5, Math.round(consumido * 0.6));
      const primera = resolver(en(corte));
      reabrir(en(corte + brecha), primera);
    } else if (!abierto) {
      if (pausa) {
        const desde = en(Math.max(inicio + 5, Math.round(activo * 0.5)));
        pausar(desde);
        const hasta = sumarMinutosHabiles(desde, pausa, cal);
        pausa = minutosHabilesEntre(desde, hasta, cal);
        detenido += pausa;
        cambio('en_espera', 'en_curso', tecnico.id, hasta);
        t.estado = 'en_curso';
      }
      let resuelto = resolver(en(activo + detenido));
      if (reabre) {
        reabrir(en(activo + detenido + brecha), resuelto);
        resuelto = resolver(en(activo + detenido + extra));
      }
      const autocierre = sumarHorasEnDiasHabiles(resuelto, c.horasAutocierre, cal);
      t.minResolucion = Math.max(0, minutosHabilesEntre(creado, resuelto, cal) - detenido);

      const confirma = escenario === 'cerrado_reciente' || azar.prob(0.4);
      const califica = confirma ? azar.prob(0.85) : azar.prob(0.45);
      const respondeLuego = sumarMinutosHabiles(resuelto, azar.entero(10, 80), cal);
      if (escenario !== 'resuelto' && califica && respondeLuego <= ahora) {
        const tarde = t.minResolucion > sla;
        t.calificacion = azar.pesado([1, 2, 3, 4, 5], tarde ? [2, 3, 4, 3, 2] : [0.3, 0.5, 2, 6, 10]);
        t.comentarioCalificacion = t.calificacion >= 4 ? azar.elegir(txt.COMENTARIOS) : null;
        if (azar.prob(0.4)) mensaje(solicitante.id, azar.elegir(txt.AGRADECIMIENTOS), respondeLuego);
        evento('calificacion', null, String(t.calificacion), solicitante.id, respondeLuego);
      }
      const cierre = confirma ? sumarMinutosHabiles(resuelto, 90, cal) : autocierre;
      if (escenario !== 'resuelto' && cierre <= ahora) {
        cambio('resuelto', 'cerrado', confirma ? solicitante.id : null, cierre);
        t.estado = 'cerrado';
        t.cerradoAt = cierre;
      } else t.autocierreAt = autocierre;
    }
  }

  // Los pedidos abiertos con actividad reciente dejan algo sin leer al técnico.
  if (abierto && responde && azar.prob(0.3))
    mensaje(solicitante.id, azar.elegir(txt.RESPUESTAS_SOLICITANTE), restarMinutosHabiles(ahora, azar.entero(1, 30), cal));

  t.minutosEnEspera = detenido;
  t.venceRespuestaAt = sumarMinutosHabiles(creado, slaR, cal);
  t.venceResolucionAt = sumarMinutosHabiles(creado, sla + detenido, cal);

  // Alertas de SLA: ya "emitidas", para que el worker no avise por datos sembrados.
  const alertas = new Set<AlertaSla>();
  if (abierto) {
    const referencia = t.enEsperaDesde ?? ahora;
    for (const a of alertasPendientes(
      {
        estado: 'en_curso',
        creadoAt: creado,
        enEsperaDesde: null,
        primeraRespuestaAt: t.primeraRespuestaAt ?? null,
        venceRespuestaAt: t.venceRespuestaAt,
        venceResolucionAt: t.venceResolucionAt,
        slaRespuestaMin: slaR,
        slaResolucionMin: sla,
        alertasSla: [],
      },
      referencia,
      cal,
    )) {
      alertas.add(`${a.clase}:${a.nivel}`);
      if (a.nivel === 'vencido') alertas.add(`${a.clase}:por_vencer`);
    }
  } else if (t.resueltoAt && t.resueltoAt > t.venceResolucionAt) {
    alertas.add('resolucion:por_vencer').add('resolucion:vencido');
  }
  for (const alerta of alertas) {
    const [clase, nivel] = alerta.split(':') as ['respuesta' | 'resolucion', 'por_vencer' | 'vencido'];
    const total = clase === 'respuesta' ? slaR : sla + detenido;
    evento(`sla_${nivel}`, null, clase, null, en(Math.ceil(nivel === 'vencido' ? total + 1 : total * 0.8)));
  }
  t.alertasSla = [...alertas];

  eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  conversacion.sort((a, b) => a.creadoAt.getTime() - b.creadoAt.getTime());
  t.actualizadoAt = new Date(
    Math.max(...eventos.map((e) => e.fecha.getTime()), ...conversacion.filter((m) => !m.interno).map((m) => m.creadoAt.getTime())),
  );
  t.version = 1 + eventos.filter((e) => ['estado', 'asignacion', 'prioridad'].includes(e.tipo)).length;

  // Lecturas: todo leído salvo, en los abiertos, a veces el último mensaje ajeno.
  const leidos: (typeof lecturas.$inferInsert)[] = [];
  const participantes = new Set([solicitante.id, ...(t.asignadoId ? [t.asignadoId] : []), ...conversacion.map((m) => m.autorId)]);
  for (const usuarioId of participantes) {
    const visibles = conversacion.filter((m) => usuarioId !== solicitante.id || !m.interno);
    const dejarSinLeer = abierto && azar.prob(0.4);
    const ultimo = dejarSinLeer
      ? visibles.filter((m) => m.autorId === usuarioId).at(-1)
      : visibles.at(-1);
    if (ultimo)
      leidos.push({
        usuarioId,
        ticketId: id,
        ultimoMensajeId: ultimo.id,
        ultimoMensajeAt: ultimo.creadoAt,
        leidoAt: ultimo.creadoAt,
      });
  }
  return { ticket: t, eventos, mensajes: conversacion, lecturas: leidos };
}

function* enLotes<T>(lista: T[], tamano = 500) {
  for (let i = 0; i < lista.length; i += tamano) yield lista.slice(i, i + tamano);
}

/** Genera e inserta los pedidos (en orden cronológico, para que los códigos sean correlativos). */
export async function insertarPedidos(tx: Tx, c: Contexto, escenarios: readonly Escenario[]): Promise<void> {
  const pedidos = escenarios.map((e) => generarPedido(c, e));
  pedidos.sort((a, b) => a.ticket.creadoAt.getTime() - b.ticket.creadoAt.getTime());

  // Cada columna del tablero queda con lo más nuevo arriba, por encima de lo que ya hubiera.
  const minimos = await tx.execute<{ estado: Estado; minimo: string }>(
    sql`select estado, min(orden_kanban) as minimo from tickets group by estado`,
  );
  const siguiente = new Map(minimos.rows.map((f) => [f.estado, Number(f.minimo) - 1024]));
  // De lo más viejo a lo más nuevo, cada uno se coloca encima del anterior.
  for (const { ticket } of pedidos) {
    const orden = siguiente.get(ticket.estado) ?? 0;
    ticket.ordenKanban = orden;
    siguiente.set(ticket.estado, orden - 1024);
  }

  for (const lote of enLotes(pedidos.map((p) => p.ticket))) await tx.insert(tickets).values(lote);
  for (const lote of enLotes(pedidos.flatMap((p) => p.eventos), 1000)) await tx.insert(ticketEventos).values(lote);
  for (const lote of enLotes(pedidos.flatMap((p) => p.mensajes), 1000)) await tx.insert(mensajes).values(lote);
  for (const lote of enLotes(pedidos.flatMap((p) => p.lecturas), 1000)) await tx.insert(lecturas).values(lote);
}
