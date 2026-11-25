import { z } from 'zod';
import { zId, zIdNum } from './comunes';

/** GET /api/estadisticas (staff). Fechas locales aaaa-mm-dd inclusive; por defecto últimos 90 días. */
export const zFiltroEstadisticas = z.object({
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  areaId: zIdNum.optional(),
  categoriaId: zIdNum.optional(),
});
export type FiltroEstadisticas = z.infer<typeof zFiltroEstadisticas>;

const n = z.number();
const nn = z.number().nullable();
export const zEstadisticas = z.object({
  rango: z.object({ desde: z.iso.date(), hasta: z.iso.date() }),
  /** Foto actual (respeta área y categoría, no el rango). */
  kpis: z.object({ abiertos: n, sinAsignar: n, vencidos: n, porVencer: n, creadosHoy: n, resueltosHoy: n }),
  tiempos: z.object({
    medianaRespuestaMin: nn,
    medianaResolucionMin: nn,
    cumplimientoSlaPct: nn,
    tasaReabiertosPct: nn,
    calificacionPromedio: nn,
  }),
  porCategoria: z.array(
    z.object({ id: n, nombre: z.string(), total: n, medianaRespuestaMin: nn, medianaResolucionMin: nn, cumplimientoSlaPct: nn }),
  ),
  porArea: z.array(z.object({ id: nn, nombre: z.string(), total: n })),
  /** `semana` = lunes aaaa-mm-dd; `backlog` = abiertos al fin de esa semana. */
  semanal: z.array(z.object({ semana: z.iso.date(), creados: n, resueltos: n, backlog: n })),
  porTecnico: z.array(z.object({ id: zId, nombre: z.string(), carga: n, resueltos: n, calificacionPromedio: nn })),
  /** dia 0 = domingo; hora local 0-23 */
  mapaCalor: z.array(z.object({ dia: n, hora: n, total: n })),
});
export type Estadisticas = z.infer<typeof zEstadisticas>;
