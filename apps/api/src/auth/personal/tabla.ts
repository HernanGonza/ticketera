/**
 * Dónde leer en la base de Personal. Para adaptarlo a la base real basta con editar este archivo
 * (si los datos están repartidos en varias tablas, cree allí una vista con estas columnas).
 */
export const TABLA_PERSONAL = {
  esquema: 'public',
  tabla: 'empleados',
  columnas: {
    email: 'email',
    nombre: 'nombre',
    areaId: 'area_id',
    areaNombre: 'area_nombre',
    activo: 'activo',
  },
} as const;
export type TablaPersonal = {
  esquema: string;
  tabla: string;
  columnas: Record<keyof (typeof TABLA_PERSONAL)['columnas'], string>;
};
