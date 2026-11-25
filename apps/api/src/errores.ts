import type { CodigoError } from '@eco/shared/schemas';

/** Error de negocio: el manejador global lo convierte en `{ error, mensaje, detalles }`. */
export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: CodigoError,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorHttp';
  }
}
export const noAutenticado = () => new ErrorHttp(401, 'no_autenticado', 'Su sesión venció. Vuelva a ingresar.');
export const sinPermiso = () => new ErrorHttp(403, 'sin_permiso', 'No tiene permiso para realizar esta acción.');
export const noEncontrado = (que = 'El recurso') => new ErrorHttp(404, 'no_encontrado', `${que} no existe.`);
