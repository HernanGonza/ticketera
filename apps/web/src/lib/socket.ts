/** Único socket de la aplicación. Se carga en forma diferida desde el armazón. */
import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  ERROR_SOCKET_NO_AUTENTICADO,
  SOCKET_PATH,
  type EventosCliente,
  type EventosServidor,
} from '@eco/shared/realtime';
import { ponerAlDia } from './al-dia';
import { refrescarSesion } from './api';
import { crearManejadores, type ContextoVivo } from './eventos-vivo';
import { canal, conexion, escribiendo, presencia, salas } from './vivo';

export function conectar(qc: QueryClient, ctx: ContextoVivo): () => void {
  const socket: Socket<EventosServidor, EventosCliente> = io({
    path: SOCKET_PATH,
    withCredentials: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
  let conectadoAntes = false;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let cerrado = false;

  const unirse = (sala: string) => {
    if (socket.connected)
      socket.emit('sala:unirse', { sala }, ({ ok }) => {
        if (ok && !cerrado) void ponerAlDia(qc, sala);
      });
  };
  canal.unirse = unirse;
  canal.salir = (sala) => {
    if (socket.connected) socket.emit('sala:salir', { sala });
  };
  canal.escribiendo = (ticketId, activo, interno) => {
    if (socket.connected) socket.emit('escribiendo', { ticketId, escribiendo: activo, interno });
  };

  const renovar = async () => {
    const ok = await refrescarSesion();
    if (cerrado) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => socket.connect(), ok ? 100 : 15_000);
  };

  socket.on('connect', () => {
    conexion.fijar(true);
    for (const s of salas.keys()) unirse(s);
    // Al volver de un corte pueden haberse perdido eventos: se vuelve a pedir todo lo visible.
    if (conectadoAntes) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' });
    conectadoAntes = true;
  });
  socket.on('disconnect', (motivo) => {
    conexion.fijar(false);
    escribiendo.fijar({});
    presencia.fijar({});
    // Cuando el servidor corta, socket.io no reintenta solo.
    if (motivo === 'io server disconnect') void renovar();
  });
  socket.on('connect_error', (e) => {
    conexion.fijar(false);
    if (e.message === ERROR_SOCKET_NO_AUTENTICADO) void renovar();
    else if (!socket.active) {
      temporizador = setTimeout(() => socket.connect(), 5000);
    }
  });

  const m = crearManejadores(qc, ctx);
  for (const nombre of Object.keys(m) as (keyof EventosServidor)[]) {
    // Cada manejador coincide con su evento; socket.io no puede expresarlo en un bucle.
    (socket.on as (n: string, f: unknown) => void).call(socket, nombre, m[nombre]);
  }

  return () => {
    cerrado = true;
    clearTimeout(temporizador);
    canal.unirse = canal.salir = canal.escribiendo = undefined;
    socket.removeAllListeners();
    socket.disconnect();
    conexion.fijar(false);
  };
}
