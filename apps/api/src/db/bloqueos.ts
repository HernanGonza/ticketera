/** Claves de los advisory locks (todas juntas para que no se repitan). */
export const BLOQUEO = {
  migracion: 7_316_001,
  /** Orden y columnas del kanban: tomarlo siempre antes de bloquear filas de tickets. */
  kanban: 7_316_002,
  asignacion: 7_316_003,
  seed: 7_316_004,
  administradores: 7_316_005,
} as const;
