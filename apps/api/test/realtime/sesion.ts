/** Token de acceso como lo emite el ingreso real: con su sesión registrada en la base. */
import { randomUUID } from 'node:crypto';
import type { UsuarioSesion } from '@eco/shared/dominio';
import { firmarSesion } from '../../src/auth/sesion';
import { sesiones, type Ejecutor } from '../../src/db';

export async function tokenDePrueba(db: Ejecutor, u: UsuarioSesion, secreto: string, duracionSeg?: number) {
  const familia = randomUUID();
  await db
    .insert(sesiones)
    .values({ usuarioId: u.id, familia, tokenHash: randomUUID(), expiraAt: new Date(Date.now() + 3600_000) });
  return firmarSesion(u, secreto, duracionSeg, familia);
}
