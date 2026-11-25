/**
 * Los eventos emitidos entre la carga de una pantalla y la entrada a su sala no llegan: al confirmarse
 * la entrada se vuelven a pedir sus datos.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { SALAS } from '@eco/shared/realtime';
import { claves } from './consultas';

function clavesDe(sala: string): QueryKey[] {
  if (sala === SALAS.tecnicos) return [claves.kanban, claves.listas];
  if (sala === SALAS.tablero) return [claves.estadisticas];
  const id = /^ticket:([^:]+)$/.exec(sala)?.[1];
  return id ? [claves.detalles, claves.mensajes(id), claves.eventos(id)] : [];
}

export async function ponerAlDia(qc: QueryClient, sala: string): Promise<void> {
  await Promise.all(
    clavesDe(sala).map(async (queryKey) => {
      // Un pedido en curso puede haberse respondido antes de entrar: no se cancela (demoraría la primera
      // carga), se espera y se vuelve a pedir.
      if (qc.isFetching({ queryKey })) await qc.refetchQueries({ queryKey, type: 'active' }, { cancelRefetch: false });
      await qc.invalidateQueries({ queryKey });
    }),
  );
}
