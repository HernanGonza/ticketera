import type { Server as ServidorHttp } from 'node:http';
import type { Deps } from '../deps';

/** El agente realtime-colas implementa Socket.IO + postgres-adapter sobre el servidor HTTP de Fastify. */
export async function iniciarRealtime(_servidor: ServidorHttp, _deps: Deps) {
  return { cerrar: async () => {} };
}
