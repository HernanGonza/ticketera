/**
 * Recupero de contraseña. El worker genera el token al enviar el mail:
 * token = 32 bytes aleatorios en base64url; `token_hash` = SHA-256 del token en hexadecimal;
 * enlace `APP_URL/restablecer?token=<token>`.
 */
import { hash } from '@node-rs/argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { actualizarUsuario, recuperacionesPassword, usuarios, type Db } from '../db';
import { ErrorHttp } from '../errores';
import { hashToken } from './sesiones';

const invalido = () =>
  new ErrorHttp(400, 'token_invalido', 'El enlace para restablecer la contraseña no es válido o venció.');

/** Consume el token (un solo uso), cambia la contraseña y revoca las sesiones, todo o nada. */
export async function restablecerPassword(db: Db, token: string, password: string): Promise<void> {
  const passwordHash = await hash(password);
  await db.transaction(async (tx) => {
    const ahora = new Date();
    const [r] = await tx
      .update(recuperacionesPassword)
      .set({ usadoAt: ahora })
      .where(
        and(
          eq(recuperacionesPassword.tokenHash, hashToken(token)),
          isNull(recuperacionesPassword.usadoAt),
          gt(recuperacionesPassword.expiraAt, ahora),
        ),
      )
      .returning({ usuarioId: recuperacionesPassword.usuarioId });
    if (!r) throw invalido();
    const [u] = await tx.select({ activo: usuarios.activo }).from(usuarios).where(eq(usuarios.id, r.usuarioId));
    if (!u?.activo) throw invalido();
    await actualizarUsuario(tx, r.usuarioId, { passwordHash });
  });
}
