/**
 * Envío por SMTP si hay `SMTP_HOST`. Sin él, en desarrollo cada correo se guarda como HTML en
 * `config.mailsDir` (visibles en /dev/mails); en producción no se escribe nada.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Logger } from 'pino';
import type { Config } from '@eco/api/config';
import type { Mail } from './plantillas';

export type ResultadoEnvio = 'enviado' | 'guardado' | 'omitido';

export interface Transporte {
  enviar: (para: string, mail: Mail) => Promise<ResultadoEnvio>;
  cerrar: () => void;
}

/** Parte segura de un nombre de archivo. */
const limpio = (s: string, largo: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9@._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, largo) || 'sin-nombre';

/** `AAAAMMDD-HHmmss-mmm_destinatario_asunto_xxxx.html` (UTC; ordena cronológicamente). */
export function nombreArchivo(para: string, asunto: string, fecha = new Date()): string {
  const marca = fecha
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('.', '-')
    .replace('Z', '');
  return `${marca}_${limpio(para, 60)}_${limpio(asunto, 60)}_${randomBytes(2).toString('hex')}.html`;
}

export function crearTransporte(config: Config, log: Logger): Transporte {
  if (config.SMTP_HOST) {
    const smtp = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return {
      async enviar(para, mail) {
        await smtp.sendMail({
          from: config.MAIL_FROM,
          to: para,
          subject: mail.asunto,
          html: mail.html,
          text: mail.texto,
          headers: { 'Auto-Submitted': 'auto-generated' },
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        return 'enviado';
      },
      cerrar: () => smtp.close(),
    };
  }
  if (config.produccion) {
    const aviso = 'SMTP_HOST no está configurado: NO se están enviando correos (incluido el recupero de contraseña)';
    log.warn(aviso);
    return {
      async enviar() {
        log.warn(aviso);
        return 'omitido';
      },
      cerrar: () => {},
    };
  }
  log.info({ carpeta: config.mailsDir }, 'Sin SMTP: los correos se guardan como archivos');
  return {
    async enviar(para, mail) {
      await mkdir(config.mailsDir, { recursive: true });
      const cabecera = `<!-- Para: ${para.replace(/-->/g, '')} -->\n`;
      await writeFile(path.join(config.mailsDir, nombreArchivo(para, mail.asunto)), cabecera + mail.html, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      return 'guardado';
    },
    cerrar: () => {},
  };
}
