import { z } from 'zod';
import { zEmail, zId, zRol } from './comunes';

export const zUsuarioSesion = z.object({
  id: zId,
  email: z.string(),
  nombre: z.string(),
  rol: zRol,
  areaId: z.number().int().nullable(),
  areaNombre: z.string().nullable(),
});
export type UsuarioActual = z.infer<typeof zUsuarioSesion>;

/** GET /api/auth/config (público) */
export const zAuthConfig = z.object({
  portalUrl: z.string(),
  modoDev: z.boolean(),
  /** Solo en modo dev */
  accesosDev: z.array(z.object({ rol: zRol, email: z.string() })),
});
export type AuthConfig = z.infer<typeof zAuthConfig>;

export const zLogin = z.object({
  email: zEmail,
  password: z.string().min(1).max(200),
  altcha: z.string().min(1).max(5000),
});
export type Login = z.infer<typeof zLogin>;

export const zPortalBody = z.object({ token: z.string().min(1).max(8000), redirect: z.string().max(500).optional() });
export const zDevToken = z.object({ rol: zRol });
export const zRecuperar = z.object({ email: zEmail, altcha: z.string().min(1).max(5000) });
export const zPasswordNueva = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(200);
export const zRestablecer = z.object({ token: z.string().min(20).max(200), password: zPasswordNueva });

export const zUsuarioExiste = z.object({ existe: z.boolean(), rol: zRol.optional() });
