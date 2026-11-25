import type { Estado, Rol } from './tipos';

/** Máquina de estados. La API la hace cumplir; la web la usa para habilitar columnas y botones. */
export const TRANSICIONES: Record<Estado, readonly Estado[]> = {
  nuevo: ['asignado', 'en_curso', 'cancelado'],
  asignado: ['nuevo', 'en_curso', 'en_espera', 'cancelado'],
  en_curso: ['asignado', 'en_espera', 'resuelto', 'cancelado'],
  en_espera: ['en_curso', 'resuelto', 'cancelado'],
  resuelto: ['en_curso', 'nuevo', 'cerrado'],
  cerrado: [],
  cancelado: [],
};

/** Columnas del kanban, en orden. `cancelado` no tiene columna. */
export const COLUMNAS_KANBAN: readonly Estado[] = [
  'nuevo',
  'asignado',
  'en_curso',
  'en_espera',
  'resuelto',
  'cerrado',
];
/** Días durante los que un ticket cerrado se sigue mostrando en el kanban. */
export const DIAS_CERRADOS_KANBAN = 7;

export const ESTADOS_ABIERTOS: readonly Estado[] = ['nuevo', 'asignado', 'en_curso', 'en_espera'];
export const esAbierto = (e: Estado) => ESTADOS_ABIERTOS.includes(e);
export const esFinal = (e: Estado) => e === 'cerrado' || e === 'cancelado';

export interface ContextoTransicion {
  rol: Rol;
  esSolicitante: boolean;
  tieneAsignado: boolean;
}

export function puedeTransicionar(de: Estado, a: Estado, ctx: ContextoTransicion): boolean {
  if (!TRANSICIONES[de].includes(a)) return false;
  // Reabrir: con técnico asignado vuelve a "en curso"; sin técnico, a "nuevo".
  if (de === 'resuelto' && a === 'nuevo' && ctx.tieneAsignado) return false;
  if (ctx.rol !== 'solicitante') return true;
  if (!ctx.esSolicitante) return false;
  if (a === 'cancelado') return de === 'nuevo' || de === 'asignado';
  if (de === 'resuelto') {
    if (a === 'cerrado' || a === 'nuevo') return true;
    return a === 'en_curso' && ctx.tieneAsignado;
  }
  return false;
}

export function transicionesPosibles(de: Estado, ctx: ContextoTransicion): Estado[] {
  return TRANSICIONES[de].filter((a) => puedeTransicionar(de, a, ctx));
}

/** Estado destino al reabrir un ticket resuelto. */
export const estadoAlReabrir = (tieneAsignado: boolean): Estado =>
  tieneAsignado ? 'en_curso' : 'nuevo';

/** Estados que exigen técnico asignado (si no hay, la API asigna a quien hace el cambio). */
export const requiereAsignado = (e: Estado) => e === 'asignado' || e === 'en_curso';
