// Declara el tipo de `inject('pgUrl')`.
import type {} from '../../../../tests/helpers/pg-global';
import { asc, eq, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '@eco/shared/dominio';
import {
  buscarUsuarioPorEmail,
  categorias,
  conectar,
  crearTicket,
  migrar,
  outboxEventos,
  sembrar,
  tickets,
} from '../../src/db';
import { crearBaseTemporal } from '../../../../tests/helpers/db';

export const CONFIG_DEMO = { seedDemo: true, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' };
/** Lunes 02/03/2026 a la hora local indicada (UTC-3). */
export const lunes = (hora: string, dia = '02') => new Date(`2026-03-${dia}T${hora}:00-03:00`);

/** Base temporal migrada y con el seed demo sin pedidos. */
export async function montar(opciones: { tickets?: number; ahora?: Date } = {}) {
  const base = await crearBaseTemporal();
  await migrar(base.url);
  const conexion = conectar(base.url, 8);
  const { db } = conexion;
  await sembrar(db, CONFIG_DEMO, { tickets: opciones.tickets ?? 0, ahora: opciones.ahora });

  const usuario = async (alias: string): Promise<UsuarioSesion> => {
    const u = await buscarUsuarioPorEmail(db, `${alias}@ecologia.misiones.gob.ar`);
    if (!u) throw new Error(`No existe ${alias}`);
    return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, areaId: u.areaId };
  };
  const categoria = async (nombre: string) => {
    const [c] = await db.select().from(categorias).where(eq(categorias.nombre, nombre)).orderBy(asc(categorias.id));
    if (!c) throw new Error(`No existe ${nombre}`);
    return c;
  };
  /** Pedido de «Otro» (SLA 240 / 2160 min, asignación manual). */
  const pedido = async (solicitanteId: string, ahora = lunes('08:00'), nombre = 'Otro') =>
    crearTicket(
      db,
      {
        categoriaId: (await categoria(nombre)).id,
        titulo: 'Pedido de prueba',
        descripcion: 'Descripción de prueba',
        datos: nombre === 'Internet/Red' ? { alcance: 'Solo a mí' } : {},
      },
      solicitanteId,
      ahora,
    );
  const fila = async (id: string) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0]!;
  const outbox = () => db.select().from(outboxEventos).orderBy(asc(outboxEventos.id));
  const vaciarOutbox = () => db.execute(sql`delete from outbox_eventos`);

  return {
    ...conexion,
    url: base.url,
    usuario,
    categoria,
    pedido,
    fila,
    outbox,
    vaciarOutbox,
    desmontar: async () => {
      await conexion.cerrar();
      await base.destruir();
    },
  };
}
export type Entorno = Awaited<ReturnType<typeof montar>>;
