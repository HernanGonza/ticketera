import { EMPLEADOS_DEMO, type EmpleadoDemo } from '../../db';
import type { EmpleadoPersonalExterno, PersonalProvider } from './index';

/** Proveedor local por defecto: los empleados del seed. */
export class PersonalMockProvider implements PersonalProvider {
  constructor(private readonly empleados: readonly EmpleadoDemo[] = EMPLEADOS_DEMO) {}

  async buscarPorEmail(email: string): Promise<EmpleadoPersonalExterno | null> {
    const buscado = email.trim().toLowerCase();
    const e = this.empleados.find((x) => x.email.toLowerCase() === buscado);
    return e ? { nombre: e.nombre, area_id: e.areaId, area_nombre: e.areaNombre, activo: e.activo } : null;
  }
}
