import type { Config } from './config';
import type { Conexion } from './db';

export interface Deps {
  config: Config;
  conexion: Conexion;
}
declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}
