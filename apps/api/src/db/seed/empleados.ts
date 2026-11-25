/** Personas de demostración. Las usa el seed y el `PersonalMockProvider`. */
import type { Rol } from '@eco/shared/dominio';
import { AREAS_BASE } from './base';

export const CONTRASENA_DEMO = 'Ecologia2024!';
const DOMINIO = 'ecologia.misiones.gob.ar';

export interface EmpleadoDemo {
  email: string;
  nombre: string;
  areaId: number;
  areaNombre: string;
  activo: boolean;
}

const persona = (usuario: string, nombre: string, areaId: number, activo = true): EmpleadoDemo => ({
  email: `${usuario}@${DOMINIO}`,
  nombre,
  areaId,
  areaNombre: AREAS_BASE.find((a) => a.id === areaId)!.nombre,
  activo,
});

const conRol = (rol: Rol, lista: EmpleadoDemo[]) => lista.map((e) => ({ ...e, rol }));

/** Usuarios que el seed crea en la base. El primero de cada rol es la cuenta principal. */
export const USUARIOS_DEMO: (EmpleadoDemo & { rol: Rol })[] = [
  ...conRol('admin', [persona('admin', 'Laura Benítez', 1)]),
  ...conRol('tecnico', [
    persona('tecnico', 'Martín Acosta', 1),
    persona('carolina.duarte', 'Carolina Duarte', 1),
    persona('diego.ramirez', 'Diego Ramírez', 1),
  ]),
  ...conRol('solicitante', [
    persona('solicitante', 'Sofía Fernández', 2),
    persona('juan.gonzalez', 'Juan González', 2),
    persona('maria.lopez', 'María López', 2),
    persona('pedro.sosa', 'Pedro Sosa', 3),
    persona('ana.villalba', 'Ana Villalba', 3),
    persona('lucas.ortiz', 'Lucas Ortiz', 3),
    persona('valeria.nunez', 'Valeria Núñez', 4),
    persona('ramon.cabrera', 'Ramón Cabrera', 4),
    persona('gabriela.silva', 'Gabriela Silva', 5),
    persona('hector.medina', 'Héctor Medina', 5),
    persona('natalia.rojas', 'Natalia Rojas', 5),
    persona('sergio.aguirre', 'Sergio Aguirre', 6),
    persona('claudia.ferreyra', 'Claudia Ferreyra', 6),
    persona('mauro.dasilva', 'Mauro Da Silva', 6),
    persona('florencia.paredes', 'Florencia Paredes', 7),
    persona('ricardo.mendoza', 'Ricardo Mendoza', 7),
    persona('julieta.kowalski', 'Julieta Kowalski', 7),
    persona('osvaldo.britez', 'Osvaldo Brítez', 8),
    persona('romina.schmidt', 'Romina Schmidt', 8),
  ]),
];

/** Empleados que figuran en Personal pero todavía no ingresaron nunca (más uno dado de baja). */
export const EMPLEADOS_SIN_USUARIO: EmpleadoDemo[] = [
  persona('nueva.empleada', 'Camila Insaurralde', 5),
  persona('nuevo.empleado', 'Tomás Zárate', 7),
  persona('baja', 'Esteban Godoy', 2, false),
];

export const EMPLEADOS_DEMO: EmpleadoDemo[] = [...USUARIOS_DEMO, ...EMPLEADOS_SIN_USUARIO].map(
  ({ email, nombre, areaId, areaNombre, activo }) => ({ email, nombre, areaId, areaNombre, activo }),
);
