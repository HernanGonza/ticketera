/** Trabajos del worker: correos, agrupado de mensajes, recupero, SLA, autocierre y asignación. */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarTicket,
  actualizarUsuario,
  categorias,
  crearMensaje,
  crearTicket,
  marcarLeido,
  notificaciones,
  outboxEventos,
  recuperacionesPassword,
  solicitarRecuperacion,
  tickets,
} from '@eco/api/db';
import { COLAS } from '@eco/shared/colas';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { configPrueba, hasta, pausa } from '../../api/test/realtime/apoyo';
import { escapar, renderizar } from '../src/mail/plantillas';
import { crearTransporte, nombreArchivo } from '../src/mail/transporte';
import { montarWorker, type EntornoWorker } from './apoyo';

let e: EntornoWorker;
let admin: UsuarioSesion;
let tecnico: UsuarioSesion;
let carolina: UsuarioSesion;
let diego: UsuarioSesion;
let sofia: UsuarioSesion;

beforeAll(async () => {
  e = await montarWorker();
  [admin, tecnico, carolina, diego, sofia] = (await e.usuarios(
    'admin',
    'tecnico',
    'carolina.duarte',
    'diego.ramirez',
    'solicitante',
  )) as [UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion, UsuarioSesion];
  await e.vaciarOutbox();
  await e.iniciar();
});
afterAll(() => e?.desmontar());
beforeEach(async () => {
  await e.reposo();
  e.enviados.splice(0);
});

async function nuevoTicket(titulo = 'No anda la impresora', categoria = 'Otro') {
  const c = await e.categoria(categoria);
  return crearTicket(
    e.db,
    {
      categoriaId: c.id,
      titulo,
      descripcion: 'Descripción de prueba',
      datos: categoria === 'Internet/Red' ? { alcance: 'Solo a mí' } : {},
    },
    sofia.id,
  );
}
async function resolver(id: string) {
  await actualizarTicket(e.db, id, { estado: 'en_curso' }, tecnico);
  await e.reposo();
  e.enviados.splice(0);
  await actualizarTicket(e.db, id, { estado: 'resuelto' }, tecnico);
}
const para = (u: UsuarioSesion) => e.enviados.filter((m) => m.para === u.email);
const avisos = (ticketId: string, tipo: string) =>
  e.db
    .select()
    .from(notificaciones)
    .where(and(eq(notificaciones.tipo, tipo as never), sql`${notificaciones.payload}->>'ticketId' = ${ticketId}`));

describe('correos de cambios', () => {
  it('avisa asignación, estado y resolución sin escribir a quien actuó', async () => {
    const id = await nuevoTicket('Falla <b>grave</b> & "urgente"');
    await e.reposo();
    const codigo = (await e.fila(id)).codigo;
    const alta = para(sofia)[0]!;
    expect(alta.html).toContain(escapar('Falla <b>grave</b> & "urgente"'));
    expect(alta.html).not.toContain('<b>grave</b>');
    expect(alta.texto).toContain(`${e.config.appUrl}/tickets/${codigo}`);
    expect(alta.texto).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    e.enviados.splice(0);

    await actualizarTicket(e.db, id, { asignadoId: tecnico.id }, admin);
    await e.reposo();
    expect(para(tecnico).map((m) => m.asunto)).toEqual([expect.stringContaining('Pedido asignado')]);
    expect(para(sofia).map((m) => m.asunto)).toEqual([expect.stringContaining('Cambio de estado')]);
    expect(para(admin)).toEqual([]);
    e.enviados.splice(0);

    await resolver(id);
    await e.reposo();
    expect(para(tecnico)).toEqual([]);
    expect(para(sofia)).toHaveLength(1);
    expect(para(sofia)[0]!.texto).toContain(`${e.config.appUrl}/tickets/${codigo}?calificar=1`);
    expect(await avisos(id, 'ticket_resuelto')).toHaveLength(1);
  });
});

describe('agrupado de mensajes', () => {
  async function conversacion() {
    const id = await nuevoTicket();
    await actualizarTicket(e.db, id, { asignadoId: tecnico.id }, admin);
    await e.reposo();
    e.enviados.splice(0);
    return id;
  }
  const pendientes = async () =>
    (
      await e.db.execute<{ n: number }>(sql`
        select count(*)::int as n from pgboss.job
        where name = ${COLAS.mail} and state = 'created' and data->>'clase' = 'mensajes'`)
    ).rows[0]!.n;

  it('un solo correo por ticket y destinatario con todo lo no leído', async () => {
    const id = await conversacion();
    for (const cuerpo of ['Primero', 'Segundo', 'Tercero <script>x</script>'])
      await crearMensaje(e.db, { ticketId: id, cuerpo }, tecnico);
    await crearMensaje(e.db, { ticketId: id, cuerpo: 'NOTA-PRIVADA', interno: true }, tecnico);
    await hasta(async () => (await e.pendientes()) === 0);
    expect(await pendientes()).toBe(1);
    expect(e.enviados).toEqual([]);
    await e.reposo();
    expect(e.enviados).toHaveLength(1);
    const [m] = e.enviados;
    expect(m!.para).toBe(sofia.email);
    expect(m!.asunto).toContain('3 mensajes nuevos');
    for (const t of ['Primero', 'Segundo', 'Tercero']) expect(m!.texto).toContain(t);
    expect(m!.html).not.toContain('<script>');
    expect(m!.html + m!.texto).not.toContain('NOTA-PRIVADA');

    // Pasado el plazo, un mensaje nuevo genera otro correo solo con lo nuevo.
    e.enviados.splice(0);
    await crearMensaje(e.db, { ticketId: id, cuerpo: 'Cuarto' }, tecnico);
    await e.reposo();
    expect(e.enviados).toHaveLength(1);
    expect(e.enviados[0]!.texto).toContain('Cuarto');
    expect(e.enviados[0]!.texto).not.toContain('Primero');
  });

  it('no envía si el destinatario ya lo leyó', async () => {
    const id = await conversacion();
    const m = await crearMensaje(e.db, { ticketId: id, cuerpo: 'Leído enseguida' }, sofia);
    await marcarLeido(e.db, id, tecnico, m.id);
    await e.reposo();
    expect(e.enviados).toEqual([]);
    expect(await avisos(id, 'mensaje_nuevo')).toHaveLength(1);
  });
});

describe('recupero de contraseña', () => {
  const recuperacion = async (id: string) =>
    (await e.db.select().from(recuperacionesPassword).where(eq(recuperacionesPassword.id, id)))[0]!;

  it('genera el token al enviar y solo guarda su hash', async () => {
    const id = await solicitarRecuperacion(e.db, sofia.id);
    await e.reposo();
    expect(e.enviados.map((m) => m.para)).toEqual([sofia.email]);
    const token = /\/restablecer\?token=([\w-]+)/.exec(e.enviados[0]!.texto)![1]!;
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect((await recuperacion(id)).tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    const guardado = await e.db.execute(sql`
      select data::text || coalesce(output::text, '') as t from pgboss.job
      union all select payload::text from outbox_eventos`);
    expect(JSON.stringify(guardado.rows)).not.toContain(token);
  });

  it('no envía si venció o ya se usó', async () => {
    await e.detenerWorkers();
    const vencida = await solicitarRecuperacion(e.db, tecnico.id, 60, new Date(Date.now() - 2 * 3600_000));
    const usada = await solicitarRecuperacion(e.db, sofia.id);
    await e.db.update(recuperacionesPassword).set({ usadoAt: new Date() }).where(eq(recuperacionesPassword.id, usada));
    await e.iniciar();
    await e.reposo();
    expect(e.enviados).toEqual([]);
    for (const id of [vencida, usada]) expect((await recuperacion(id)).tokenHash).toBeNull();
  });
});

describe('tareas programadas', () => {
  it('SLA: alerta una sola vez a quien atiende', async () => {
    const id = await nuevoTicket();
    await actualizarTicket(e.db, id, { asignadoId: tecnico.id }, admin);
    await e.reposo();
    e.enviados.splice(0);
    await e.db
      .update(tickets)
      .set({ venceRespuestaAt: new Date('2026-03-02T12:00:00Z'), venceResolucionAt: new Date('2026-03-03T12:00:00Z') })
      .where(eq(tickets.id, id));
    const worker = await e.iniciar();
    await worker.boss.send(COLAS.sla, {});
    await e.reposo();
    await worker.boss.send(COLAS.sla, {});
    await e.reposo();
    expect(await avisos(id, 'sla_vencido')).toHaveLength(2);
    expect(para(tecnico).filter((m) => m.asunto.includes('Plazo vencido'))).toHaveLength(2);
    expect(para(sofia)).toEqual([]);
    const eventos = await e.db.select().from(outboxEventos).where(eq(outboxEventos.tipo, 'sla.alerta'));
    expect(eventos.filter((x) => x.payload.ticketId === id)).toHaveLength(2);
  });

  it('autocierra los resueltos con el plazo cumplido y avisa al solicitante', async () => {
    const id = await nuevoTicket();
    await actualizarTicket(e.db, id, { asignadoId: tecnico.id }, admin);
    await resolver(id);
    await e.reposo();
    await e.db.update(tickets).set({ autocierreAt: new Date(Date.now() - 60_000) }).where(eq(tickets.id, id));
    e.enviados.splice(0);
    const worker = await e.iniciar();
    await worker.boss.send(COLAS.autocierre, {});
    await e.reposo();
    expect((await e.fila(id)).estado).toBe('cerrado');
    expect(para(sofia).map((m) => m.asunto)).toEqual([expect.stringContaining('Cambio de estado')]);
  });

  it('asigna en ronda entre los técnicos', async () => {
    // Todos parten sin carga.
    await e.db.update(tickets).set({ estado: 'cancelado' });
    await e.db
      .update(categorias)
      .set({ modoAsignacion: 'round_robin', tecnicoDefaultId: null })
      .where(eq(categorias.nombre, 'Otro'));
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(await nuevoTicket(`Pedido ${i}`));
      await e.reposo();
    }
    const asignados = await Promise.all(ids.map(async (id) => (await e.fila(id)).asignadoId));
    const equipo = [tecnico.id, carolina.id, diego.id];
    expect(new Set(asignados.slice(0, 3))).toEqual(new Set(equipo));
    expect(asignados.slice(3).every((a) => equipo.includes(a!))).toBe(true);
    expect(new Set(asignados.slice(3)).size).toBe(3);
    expect((await e.fila(ids[0]!)).estado).toBe('asignado');
    await e.db.update(categorias).set({ modoAsignacion: 'manual' }).where(eq(categorias.nombre, 'Otro'));
  });

  it('registra los crones en hora argentina', async () => {
    const worker = await e.iniciar({ crones: true });
    const programados = await worker.boss.getSchedules();
    expect(programados.map((s) => s.name).sort()).toEqual(
      [COLAS.sla, COLAS.autocierre, COLAS.limpieza, COLAS.outbox].sort(),
    );
    expect(programados.every((s) => s.timezone === 'America/Argentina/Buenos_Aires')).toBe(true);
    await worker.boss.send(COLAS.limpieza, {});
    await worker.boss.send(COLAS.outbox, {});
    await e.reposo();
    await e.detenerWorkers();
    await e.iniciar();
  });

  it('un correo que falla queda para reintentar sin datos internos en el error', async () => {
    await e.detenerWorkers();
    const worker = await e.iniciar({
      transporte: {
        enviar: async () => {
          throw new Error('SMTP caído token=abc123');
        },
        cerrar: () => {},
      },
    });
    await solicitarRecuperacion(e.db, carolina.id);
    let salida = '';
    await hasta(async () => {
      const r = await e.db.execute<{ salida: string }>(
        sql`select output::text as salida from pgboss.job where name = ${COLAS.mail} and state = 'retry'`,
      );
      salida = r.rows[0]?.salida ?? '';
      return salida !== '';
    });
    expect(salida).toContain('SMTP caído');
    expect(salida).not.toContain('abc123');
    await e.db.execute(sql`delete from pgboss.job where state = 'retry'`);
    await worker.detener();
    await e.detenerWorkers();
    await e.iniciar();
  });

  it('desactivar a un técnico deja de avisarle', async () => {
    const id = await nuevoTicket();
    await actualizarUsuario(e.db, diego.id, { activo: false });
    await e.reposo();
    await pausa(100);
    e.enviados.splice(0);
    await crearMensaje(e.db, { ticketId: id, cuerpo: '¿Novedades?' }, sofia);
    await e.reposo();
    expect(para(diego)).toEqual([]);
    expect(para(carolina)).toHaveLength(1);
  });
});

describe('transporte', () => {
  const mail = renderizar({ asunto: 'Asunto\r\nBcc: x@y', titulo: 'T', nombre: 'N', parrafos: ['P'] });

  it('sin SMTP guarda archivos con un nombre seguro', async () => {
    expect(mail.asunto).not.toMatch(/[\r\n]/);
    expect(nombreArchivo('../../a@b.test', '../x/y ñ')).toMatch(/^[\w@.-]+\.html$/);
    expect(await crearTransporte(e.config, e.log).enviar('a@b.test', mail)).toBe('guardado');
    const [archivo] = await e.archivos();
    expect(archivo!.nombre).toContain('a@b.test_Asunto');
  });

  it('en producción sin SMTP no escribe nada y avisa', async () => {
    const avisos: string[] = [];
    const log = { ...e.log, warn: (m: string) => void avisos.push(m), info: () => {} } as unknown as typeof e.log;
    const config = configPrueba(e.url, {
      NODE_ENV: 'production',
      DATA_DIR: `${e.config.dataDir}-prod`,
      SESSION_SECRET: 's'.repeat(40),
      ALTCHA_HMAC_KEY: 'a'.repeat(40),
    });
    const t = crearTransporte(config, log);
    expect(await t.enviar('a@b.test', mail)).toBe('omitido');
    expect(avisos[0]).toContain('SMTP_HOST');
    await expect(import('node:fs/promises').then((f) => f.readdir(config.mailsDir))).rejects.toThrow();
  });
});
