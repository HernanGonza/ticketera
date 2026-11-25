import { z } from 'zod';
import { ESTADOS, PRIORIDADES, ROLES } from '../dominio/tipos';

export const zRol = z.enum(ROLES);
export const zEstado = z.enum(ESTADOS);
export const zPrioridad = z.enum(PRIORIDADES);
export const zId = z.uuid();
export const zIdNum = z.coerce.number().int().positive();
/** Fecha ISO 8601 */
export const zFecha = z.iso.datetime({ offset: true });
export const zEmail = z.string().trim().toLowerCase().pipe(z.email().max(200));

export const zPersona = z.object({ id: zId, nombre: z.string() });
export type Persona = z.infer<typeof zPersona>;

export const CODIGOS_ERROR = [
  'validacion',
  'no_autenticado',
  'sin_permiso',
  'no_encontrado',
  'conflicto_version',
  'transicion_invalida',
  'conflicto',
  'demasiados_intentos',
  'usuario_no_habilitado',
  'credenciales_invalidas',
  'captcha_invalido',
  'token_invalido',
  'archivo_invalido',
  'interno',
] as const;
export type CodigoError = (typeof CODIGOS_ERROR)[number];

/** Cuerpo de toda respuesta de error de la API. `mensaje` es apto para mostrar al usuario. */
export const zError = z.object({
  error: z.enum(CODIGOS_ERROR),
  mensaje: z.string(),
  detalles: z.unknown().optional(),
});
export type ErrorApi = z.infer<typeof zError>;
export const zOk = z.object({ ok: z.literal(true) });
