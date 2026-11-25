/** Sistema de Personal: fuente de nombre, área y estado de cada empleado. */
import type { Config } from '../../config';
import { PersonalMockProvider } from './mock';
import { PersonalPostgresProvider } from './postgres';

export interface EmpleadoPersonalExterno {
  nombre: string;
  area_id: number | string | null;
  area_nombre: string | null;
  activo: boolean;
}

export interface PersonalProvider {
  /** null = el correo no figura en Personal. Lanza si Personal no responde. */
  buscarPorEmail(email: string): Promise<EmpleadoPersonalExterno | null>;
  cerrar?(): Promise<void>;
}

export const crearPersonal = (config: Pick<Config, 'PERSONAL_DATABASE_URL'>): PersonalProvider =>
  config.PERSONAL_DATABASE_URL
    ? new PersonalPostgresProvider(config.PERSONAL_DATABASE_URL)
    : new PersonalMockProvider();

export { PersonalMockProvider, PersonalPostgresProvider };
