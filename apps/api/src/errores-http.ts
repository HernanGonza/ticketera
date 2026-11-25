/** Manejadores globales: toda respuesta de error sale como `zError`, en español y sin detalles internos. */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import type { CodigoError } from '@eco/shared/schemas';
import { ErrorHttp } from './errores';

const cuerpo = (error: CodigoError, mensaje: string, detalles?: unknown) => ({ error, mensaje, detalles });

const GENERICO = 'No se pudo procesar el pedido. Intente nuevamente en unos instantes.';

/** Errores 4xx propios de Fastify y sus plugins (sin reenviar sus mensajes). */
function porEstado(status: number): [CodigoError, string] {
  if (status === 413) return ['archivo_invalido', 'El contenido enviado supera el tamaño permitido.'];
  if (status === 415) return ['validacion', 'El formato del pedido no es admitido.'];
  if (status === 429) return ['demasiados_intentos', 'Se registraron demasiados intentos. Espere unos minutos.'];
  return ['validacion', 'El pedido no es válido.'];
}

export function manejarError(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ErrorHttp) {
    const espera = (error.detalles as { reintentarEnSeg?: number } | undefined)?.reintentarEnSeg;
    if (error.status === 429 && espera) reply.header('retry-after', espera);
    return reply.status(error.status).send(cuerpo(error.codigo, error.message, error.detalles));
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const campos: Record<string, string> = {};
    for (const v of error.validation) {
      const campo = v.instancePath.replace(/^\//, '').replace(/\//g, '.') || '_';
      campos[campo] ??= v.message ?? 'Valor no válido.';
    }
    return reply.status(400).send(cuerpo('validacion', 'Revise los datos enviados.', { campos }));
  }
  const status = error.statusCode;
  if (!isResponseSerializationError(error) && status && status >= 400 && status < 500)
    return reply.status(status).send(cuerpo(...porEstado(status)));
  req.log.error({ err: error }, 'Error no controlado');
  return reply.status(500).send(cuerpo('interno', GENERICO));
}

export const manejarNoEncontrado = (_req: FastifyRequest, reply: FastifyReply) =>
  reply.status(404).send(cuerpo('no_encontrado', 'La dirección solicitada no existe.'));
