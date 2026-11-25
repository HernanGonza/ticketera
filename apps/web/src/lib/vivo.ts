/** Estado efímero del tiempo real (sin dependencias, para que la interfaz no cargue el socket). */
import type { UsuarioPresente } from '@eco/shared/realtime';
import { crearAlmacen } from './almacen';

export const conexion = crearAlmacen(false);
export const presencia = crearAlmacen<Record<string, UsuarioPresente[]>>({});

export interface Escribiendo {
  usuario: UsuarioPresente;
  interno: boolean;
}
export const escribiendo = crearAlmacen<Record<string, Escribiendo[]>>({});

const vencimientos = new Map<string, ReturnType<typeof setTimeout>>();

export function fijarEscribiendo(ticketId: string, usuario: UsuarioPresente, activo: boolean, interno: boolean) {
  const clave = `${ticketId}:${usuario.id}`;
  clearTimeout(vencimientos.get(clave));
  escribiendo.fijar((e) => {
    const actual = e[ticketId] ?? [];
    const resto = actual.filter((x) => x.usuario.id !== usuario.id);
    if (!activo && resto.length === actual.length) return e;
    return { ...e, [ticketId]: activo ? [...resto, { usuario, interno }] : resto };
  });
  // Resguardo si nunca llega el aviso de fin.
  if (activo) vencimientos.set(clave, setTimeout(() => fijarEscribiendo(ticketId, usuario, false, interno), 6000));
}

/** Salas pedidas por las pantallas (con conteo de referencias) y canal de salida del socket. */
export const salas = new Map<string, number>();
export const canal: {
  unirse?: (sala: string) => void;
  salir?: (sala: string) => void;
  escribiendo?: (ticketId: string, activo: boolean, interno: boolean) => void;
} = {};

export function unirSala(sala: string): () => void {
  const n = salas.get(sala) ?? 0;
  salas.set(sala, n + 1);
  if (n === 0) canal.unirse?.(sala);
  return () => {
    const quedan = (salas.get(sala) ?? 1) - 1;
    if (quedan > 0) salas.set(sala, quedan);
    else {
      salas.delete(sala);
      canal.salir?.(sala);
    }
  };
}
