/** Seed idempotente: una segunda corrida no duplica ni pisa nada. */
import { hash } from '@node-rs/argon2';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { ESTADOS_ABIERTOS } from '@eco/shared/dominio';
import { CONFIGURACION_DEFAULT, zPasswordNueva } from '@eco/shared/schemas';
import type { Config } from '../../config';
import { BLOQUEO } from '../bloqueos';
import type { Ejecutor, Tx } from '../conexion';
import { leerConfiguracion } from '../configuracion';
import { areas, categorias, configuracion, notificaciones, respuestasRapidas, tickets, usuarios } from '../schema';
import { crearAzar } from './azar';
import { AREAS_BASE, CATEGORIAS_BASE } from './base';
import { CONTRASENA_DEMO, USUARIOS_DEMO } from './empleados';
import { RESPUESTAS_RAPIDAS } from './textos';
import { insertarPedidos, type Contexto, type Escenario } from './tickets';

export * from './empleados';

const SEMILLA = 20_240_101;

export type ConfigSeed = Pick<Config, 'seedDemo' | 'ADMIN_EMAIL' | 'ADMIN_PASSWORD'>;
export interface ResultadoSeed {
  demo: boolean;
  usuariosCreados: number;
  ticketsCreados: number;
  avisos: string[];
}

/** Distribución de los ~300 pedidos de demostración. */
const DISTRIBUCION: [Escenario, number][] = [
  ['historico', 219],
  ['cerrado_reciente', 15],
  ['resuelto', 14],
  ['cancelado', 10],
  ['nuevo', 9],
  ['asignado', 9],
  ['en_curso', 13],
  ['en_espera', 8],
  ['reabierto_abierto', 3],
];

function repartir(total: number): Escenario[] {
  const suma = DISTRIBUCION.reduce((s, [, n]) => s + n, 0);
  const lista = DISTRIBUCION.flatMap(([e, n]) => Array<Escenario>(Math.round((n * total) / suma)).fill(e));
  while (lista.length < total) lista.push('historico');
  return lista.slice(0, total);
}

async function contexto(tx: Tx, ahora: Date, semilla: number): Promise<Contexto> {
  const config = await leerConfiguracion(tx);
  const personas = await tx.select().from(usuarios).where(eq(usuarios.activo, true)).orderBy(asc(usuarios.email));
  /** Cuenta principal primero. */
  const ordenar = (rol: string, principal: string) =>
    personas
      .filter((u) => u.rol === rol)
      .sort((a, b) => Number(b.email.startsWith(principal)) - Number(a.email.startsWith(principal)));
  const tecnicos = ordenar('tecnico', 'tecnico@');
  const solicitantes = ordenar('solicitante', 'solicitante@');
  const lista = await tx.select().from(categorias).where(eq(categorias.activa, true)).orderBy(asc(categorias.orden));
  if (!tecnicos.length || !solicitantes.length || !lista.length)
    throw new Error('Para generar pedidos se necesitan técnicos, solicitantes y categorías (ejecute el seed demo).');
  return {
    azar: crearAzar(semilla),
    ahora,
    calendario: config.calendario,
    horasAutocierre: config.horasAutocierre,
    categorias: lista,
    tecnicos,
    solicitantes,
    admin: ordenar('admin', 'admin@')[0],
  };
}

async function sembrarBase(tx: Tx) {
  for (const [clave, valor] of Object.entries(CONFIGURACION_DEFAULT))
    await tx.insert(configuracion).values({ clave, valor }).onConflictDoNothing();
  // Solo en una base vacía: no se reponen áreas que un administrador haya renombrado.
  const [a] = await tx.select({ n: count() }).from(areas);
  if (!a?.n) {
    await tx.insert(areas).values(AREAS_BASE.map((x) => ({ ...x })));
    await tx.execute(sql`select setval(pg_get_serial_sequence('areas', 'id'), (select max(id) from areas))`);
  }
}

async function sembrarCategorias(tx: Tx, demo: boolean) {
  const [c] = await tx.select({ n: count() }).from(categorias);
  if (c?.n) return;
  const tecnicos: (string | undefined)[] = [];
  for (const u of demo ? USUARIOS_DEMO.filter((x) => x.rol === 'tecnico') : []) {
    const [f] = await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, u.email));
    tecnicos.push(f?.id);
  }
  await tx.insert(categorias).values(
    CATEGORIAS_BASE.map((x, i) => {
      const fijo = demo && x.tecnico !== undefined ? tecnicos[x.tecnico] : undefined;
      const modo = !demo || (x.modo === 'fija' && !fijo) ? 'manual' : x.modo;
      return {
        nombre: x.nombre,
        descripcion: x.descripcion,
        icono: x.icono,
        prioridadDefault: x.prioridad,
        slaRespuestaMin: x.respuestaMin,
        slaResolucionMin: x.resolucionMin,
        campos: x.campos,
        modoAsignacion: modo,
        tecnicoDefaultId: fijo ?? null,
        orden: i + 1,
      };
    }),
  );
}

async function sembrarNotificaciones(tx: Tx, c: Contexto) {
  const principales = [c.tecnicos[0], c.admin].filter((u) => u !== undefined);
  const recientes = await tx
    .select()
    .from(tickets)
    .where(inArray(tickets.estado, [...ESTADOS_ABIERTOS]))
    .orderBy(sql`${tickets.creadoAt} desc`)
    .limit(6);
  const filas = principales.flatMap((u) =>
    recientes.map((t, i) => ({
      usuarioId: u.id,
      tipo: 'ticket_creado' as const,
      payload: { ticketId: t.id, codigo: t.codigo, titulo: t.titulo, texto: `Nuevo pedido ${t.codigo}: ${t.titulo}` },
      leida: i > 2,
      creadaAt: t.creadoAt,
    })),
  );
  if (filas.length) await tx.insert(notificaciones).values(filas.reverse());
}

/**
 * Carga los datos iniciales. Con `seedDemo`: usuarios de prueba, respuestas rápidas y ~300 pedidos
 * (solo si no hay ninguno). Sin demo: configuración, áreas, categorías y el administrador de
 * `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
 */
export async function sembrar(
  db: Ejecutor,
  config: ConfigSeed,
  opciones: { ahora?: Date; tickets?: number } = {},
): Promise<ResultadoSeed> {
  const ahora = opciones.ahora ?? new Date();
  const demo = config.seedDemo;
  const email = config.ADMIN_EMAIL.toLowerCase();
  if (email && config.ADMIN_PASSWORD && !zPasswordNueva.safeParse(config.ADMIN_PASSWORD).success)
    throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres.');
  const claveDemo = demo ? await hash(CONTRASENA_DEMO) : '';
  const claveAdmin = email && config.ADMIN_PASSWORD ? await hash(config.ADMIN_PASSWORD) : null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BLOQUEO.seed})`);
    const resultado: ResultadoSeed = { demo, usuariosCreados: 0, ticketsCreados: 0, avisos: [] };
    await sembrarBase(tx);

    if (claveAdmin) {
      const r = await tx
        .insert(usuarios)
        .values({ email, nombre: 'Administrador', rol: 'admin', passwordHash: claveAdmin })
        .onConflictDoNothing()
        .returning({ id: usuarios.id });
      resultado.usuariosCreados += r.length;
    }

    if (demo) {
      const areasActuales = new Set((await tx.select({ id: areas.id }).from(areas)).map((a) => a.id));
      const azar = crearAzar(SEMILLA);
      const r = await tx
        .insert(usuarios)
        .values(
          USUARIOS_DEMO.map((u) => ({
            id: azar.uuid(),
            email: u.email,
            nombre: u.nombre,
            rol: u.rol,
            areaId: areasActuales.has(u.areaId) ? u.areaId : null,
            passwordHash: claveDemo,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: usuarios.id });
      resultado.usuariosCreados += r.length;
    }

    await sembrarCategorias(tx, demo);

    if (demo) {
      const [r] = await tx.select({ n: count() }).from(respuestasRapidas);
      if (!r?.n)
        await tx.insert(respuestasRapidas).values(RESPUESTAS_RAPIDAS.map(([titulo, cuerpo]) => ({ titulo, cuerpo })));
      const [t] = await tx.select({ n: count() }).from(tickets);
      const cuantos = opciones.tickets ?? 300;
      if (!t?.n && cuantos > 0) {
        const c = await contexto(tx, ahora, SEMILLA);
        await insertarPedidos(tx, c, repartir(cuantos));
        await sembrarNotificaciones(tx, c);
        resultado.ticketsCreados = cuantos;
      }
    } else {
      const [admin] = await tx
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(and(eq(usuarios.rol, 'admin'), eq(usuarios.activo, true)))
        .limit(1);
      if (!admin)
        resultado.avisos.push('No hay ningún administrador: defina ADMIN_EMAIL y ADMIN_PASSWORD y repita el seed.');
    }
    return resultado;
  });
}

/**
 * Agrega `n` pedidos **abiertos** (pruebas de rendimiento del kanban). Requiere el seed demo.
 * No escribe en el outbox. Devuelve cuántos creó.
 */
export async function sembrarTickets(
  db: Ejecutor,
  n: number,
  opciones: { ahora?: Date; semilla?: number } = {},
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BLOQUEO.seed})`);
    const [previos] = await tx.select({ n: count() }).from(tickets);
    const c = await contexto(tx, opciones.ahora ?? new Date(), opciones.semilla ?? SEMILLA + 1 + (previos?.n ?? 0));
    const estados: Escenario[] = ['nuevo', 'asignado', 'en_curso', 'en_espera'];
    await insertarPedidos(
      tx,
      c,
      Array.from({ length: n }, (_, i) => estados[i % estados.length]!),
    );
    return n;
  });
}
