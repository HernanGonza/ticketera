import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zAdjunto } from '@eco/shared/schemas';
import { crearMensaje } from '../../src/db';
import { sanearNombre } from '../../src/rutas/archivos';
import { formulario, montarApi, type Api } from './base';

let e: Api;
type Cliente = ReturnType<Api['cliente']>;
let sol: Cliente, colega: Cliente, tec: Cliente;
let ticket: string;
let otroTicket: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(200)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);

beforeAll(async () => {
  e = await montarApi();
  [sol, colega, tec] = (await Promise.all(
    ['solicitante', 'juan.gonzalez', 'tecnico'].map((a) => e.ingresar(a)),
  )) as [Cliente, Cliente, Cliente];
  const id = (await e.usuario('solicitante')).id;
  ticket = await e.pedido(id);
  otroTicket = await e.pedido(id);
});
afterAll(() => e.cerrarTodo());

const subir = (c: Cliente, nombre: string, contenido: Buffer | string, query = '', t = ticket) =>
  c.pedir({ method: 'POST', url: `/api/tickets/${t}/adjuntos${query}`, ...formulario(nombre, contenido) });
const enDisco = (): string[] => {
  const raiz = e.app.deps.config.uploadsDir;
  try {
    return (readdirSync(raiz, { recursive: true }) as string[]).filter((f) => statSync(path.join(raiz, f)).isFile());
  } catch {
    return [];
  }
};

describe('adjuntos', () => {
  it('sube una imagen con nombre aleatorio y la entrega solo autenticada', async () => {
    const r = await subir(sol, '../../etc/captura de pantalla ñandú.png', PNG);
    expect(r.statusCode, r.body).toBe(201);
    const a = zAdjunto.parse(r.json());
    expect(a).toMatchObject({ nombre: 'captura de pantalla ñandú.png', mime: 'image/png', bytes: PNG.length });
    expect(r.body).not.toContain('ruta');
    expect(enDisco()).toHaveLength(1);
    expect(enDisco()[0]).toMatch(/^\d{4}[\\/]\d{2}[\\/][0-9a-f-]{36}\.png$/);

    const d = await sol.get(`/api/adjuntos/${a.id}`);
    expect(d.rawPayload.equals(PNG)).toBe(true);
    expect(d.headers).toMatchObject({ 'content-type': 'image/png', 'x-content-type-options': 'nosniff' });
    expect(d.headers['content-disposition']).toMatch(/^inline; filename="captura de pantalla _and_\.png"; filename\*=UTF-8''/);
    expect(d.headers['content-security-policy']).toContain('sandbox');
    expect((await sol.get(`/api/adjuntos/${a.id}?descargar=1`)).headers['content-disposition']).toMatch(/^attachment/);
    expect((await e.app.inject({ url: `/api/adjuntos/${a.id}` })).statusCode).toBe(401);
    expect((await colega.get(`/api/adjuntos/${a.id}`)).statusCode).toBe(200);
    const ajeno = await e.ingresar('pedro.sosa');
    expect((await ajeno.get(`/api/adjuntos/${a.id}`)).statusCode).toBe(404);
  });

  it.each([
    ['imagen.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ['pagina.html', '<html><script>alert(1)</script></html>'],
    ['disfrazada.txt', '  <!DOCTYPE html><script>alert(1)</script>'],
    ['disfrazada.csv', '<?xml version="1.0"?><svg/>'],
    ['foto.png', '<svg/>'],
    ['programa.exe', EXE],
    ['foto.png', EXE],
    ['informe.pdf', ELF],
    ['guion.sh', '#!/bin/sh\nrm -rf /'],
    ['macro.js', 'alert(1)'],
    ['binario.txt', Buffer.from([65, 0, 1, 2])],
    ['paquete.jar', ZIP],
    ['instalador.msi', Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600)])],
    ['sin-extension', 'hola'],
    ['vacio.txt', ''],
  ])('rechaza %s', async (nombre, contenido) => {
    const antes = enDisco().length;
    const r = await subir(sol, nombre, contenido);
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().error).toBe('archivo_invalido');
    expect(enDisco()).toHaveLength(antes);
  });

  it('admite texto, PDF y ZIP, y corrige la extensión que no coincide', async () => {
    const texto = (await subir(sol, 'registro.log', 'línea 1\r\nlínea 2\n')).json();
    expect(texto.mime).toBe('text/plain');
    const d = await sol.get(`/api/adjuntos/${texto.id}`);
    expect(d.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(d.headers['content-disposition']).toMatch(/^attachment/);
    const pdf = (await subir(sol, 'nota.pdf', PDF)).json();
    expect((await sol.get(`/api/adjuntos/${pdf.id}`)).headers['content-disposition']).toMatch(/^inline/);
    expect((await subir(sol, 'copias.zip', ZIP)).statusCode).toBe(201);
    expect((await subir(sol, 'malware.exe', PNG)).json()).toMatchObject({
      nombre: 'malware.exe.png',
      mime: 'image/png',
    });
  });

  it('respeta el tamaño máximo configurado', async () => {
    await e.db.execute(sql`update configuracion set valor = '1'::jsonb where clave = 'adjuntoMaxMb'`);
    const antes = enDisco().length;
    const r = await subir(sol, 'grande.txt', Buffer.alloc(1024 * 1024 + 1, 'a'));
    expect(r.statusCode).toBe(413);
    expect(r.json().error).toBe('archivo_invalido');
    expect(enDisco()).toHaveLength(antes);
    expect((await subir(sol, 'justo.txt', Buffer.alloc(1024 * 1024, 'a'))).statusCode).toBe(201);
  });

  it('exige multipart y el campo «archivo»', async () => {
    expect((await sol.post(`/api/tickets/${ticket}/adjuntos`, {})).statusCode).toBe(400);
    const r = await sol.pedir({
      method: 'POST',
      url: `/api/tickets/${ticket}/adjuntos`,
      ...formulario('a.txt', 'hola', 'otro'),
    });
    expect(r.json().error).toBe('archivo_invalido');
  });

  it('solo adjunta a mensajes propios del mismo pedido y oculta los de notas internas', async () => {
    const [yo, staff] = await Promise.all([e.usuario('solicitante'), e.usuario('tecnico')]);
    const propio = await crearMensaje(e.db, { ticketId: ticket, cuerpo: 'mío' }, yo);
    const ajeno = await crearMensaje(e.db, { ticketId: ticket, cuerpo: 'del técnico' }, staff);
    const deOtro = await crearMensaje(e.db, { ticketId: otroTicket, cuerpo: 'otro' }, yo);
    const nota = await crearMensaje(e.db, { ticketId: ticket, cuerpo: 'nota', interno: true }, staff);
    const antes = enDisco().length;
    const estado = async (c: Cliente, mensaje: string) =>
      (await subir(c, 'a.txt', 'hola', `?mensajeId=${mensaje}`)).statusCode;
    expect(await estado(sol, ajeno.id)).toBe(403);
    expect(await estado(sol, deOtro.id)).toBe(404);
    expect(await estado(sol, nota.id)).toBe(404);
    expect(await estado(colega, propio.id)).toBe(403);
    expect(enDisco()).toHaveLength(antes);
    expect(await estado(sol, propio.id)).toBe(201);

    const interno = (await subir(tec, 'reservado.txt', 'dato', `?mensajeId=${nota.id}`)).json();
    expect(interno.interno).toBe(true);
    expect((await sol.get(`/api/adjuntos/${interno.id}`)).statusCode).toBe(404);
    expect((await colega.get(`/api/adjuntos/${interno.id}`)).statusCode).toBe(404);
    expect((await sol.get(`/api/tickets/${ticket}`)).body).not.toContain('reservado.txt');
    expect((await tec.get(`/api/adjuntos/${interno.id}`)).statusCode).toBe(200);
  });

  it('limita la cantidad por mensaje y borra el archivo si no se puede registrar', async () => {
    const yo = await e.usuario('solicitante');
    const m = await crearMensaje(e.db, { ticketId: otroTicket, cuerpo: 'varios' }, yo);
    for (let i = 0; i < 10; i++)
      expect((await subir(sol, `${i}.txt`, 'x', `?mensajeId=${m.id}`, otroTicket)).statusCode).toBe(201);
    const antes = enDisco().length;
    expect((await subir(sol, '11.txt', 'x', `?mensajeId=${m.id}`, otroTicket)).statusCode).toBe(400);
    expect(enDisco()).toHaveLength(antes);
    await e.db.execute(sql`alter table adjuntos add constraint prueba check (nombre <> 'falla.txt')`);
    expect((await subir(sol, 'falla.txt', 'x')).statusCode).toBe(500);
    expect(enDisco()).toHaveLength(antes);
    await e.db.execute(sql`alter table adjuntos drop constraint prueba`);
  });

  it('sanea nombres peligrosos', () => {
    expect(sanearNombre('..\\..\\win\\a‮gnp.exe')).toBe('agnp.exe');
    expect(sanearNombre('a"\r\nb<>.txt')).toBe('ab.txt');
    expect(sanearNombre('...')).toBe('archivo');
    expect(sanearNombre(`${'x'.repeat(400)}.pdf`)).toHaveLength(114);
  });
});
