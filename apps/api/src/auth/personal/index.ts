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

/** Sin base de Personal y fuera de la demo: solo ingresan los usuarios locales. */
const SIN_PERSONAL: PersonalProvider = { buscarPorEmail: async () => null };

/** Los empleados simulados solo existen en desarrollo o con los datos de demostración. */
export function crearPersonal(
  config: Pick<Config, 'PERSONAL_DATABASE_URL' | 'produccion' | 'seedDemo'>,
): PersonalProvider {
  if (config.PERSONAL_DATABASE_URL) return new PersonalPostgresProvider(config.PERSONAL_DATABASE_URL);
  return !config.produccion || config.seedDemo ? new PersonalMockProvider() : SIN_PERSONAL;
}

export { PersonalMockProvider, PersonalPostgresProvider };
