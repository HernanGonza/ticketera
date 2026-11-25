/**
 * Cálculo de tiempos hábiles. Argentina no aplica horario de verano: UTC-3 fijo.
 * - SLA: minutos dentro del horario hábil de días hábiles.
 * - Autocierre: "72 h hábiles" = 72 horas corridas contando solo días hábiles (sin fines de semana ni feriados).
 */
export interface Calendario {
  /** 0 = domingo … 6 = sábado */
  dias: number[];
  /** "HH:mm" hora local */
  desde: string;
  hasta: string;
  /** "aaaa-mm-dd" */
  feriados: string[];
}

export const CALENDARIO_DEFAULT: Calendario = {
  dias: [1, 2, 3, 4, 5],
  desde: '07:00',
  hasta: '19:00',
  feriados: [],
};

const DESFASE_MS = -3 * 3600_000;
const DIA_MS = 86_400_000;
const MAX_DIAS = 3700;

const aMinutos = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
/** Convierte a "reloj local" expresado como milisegundos UTC. */
const aLocal = (d: Date) => d.getTime() + DESFASE_MS;
const desdeLocal = (ms: number) => new Date(ms - DESFASE_MS);
const inicioDia = (localMs: number) => Math.floor(localMs / DIA_MS) * DIA_MS;

export function esDiaHabil(diaLocalMs: number, cal: Calendario): boolean {
  const d = new Date(diaLocalMs);
  return cal.dias.includes(d.getUTCDay()) && !cal.feriados.includes(d.toISOString().slice(0, 10));
}

function franja(cal: Calendario): [number, number] {
  const ini = aMinutos(cal.desde) * 60_000;
  const fin = aMinutos(cal.hasta) * 60_000;
  if (cal.dias.length === 0 || fin <= ini) throw new Error('Calendario hábil inválido');
  return [ini, fin];
}

/** Fecha resultante de sumar `minutos` de horario hábil a `inicio`. */
export function sumarMinutosHabiles(inicio: Date, minutos: number, cal: Calendario): Date {
  const [ini, fin] = franja(cal);
  let resta = Math.max(0, minutos) * 60_000;
  const t = aLocal(inicio);
  for (let i = 0, dia = inicioDia(t); i < MAX_DIAS; i++, dia += DIA_MS) {
    if (!esDiaHabil(dia, cal)) continue;
    const desde = Math.max(t, dia + ini);
    const disponible = dia + fin - desde;
    if (disponible <= 0) continue;
    if (resta <= disponible) return desdeLocal(desde + resta);
    resta -= disponible;
  }
  throw new Error('No se pudo calcular el vencimiento: revise el calendario hábil');
}

/** Minutos hábiles entre dos instantes (0 si `hasta` <= `desde`). */
export function minutosHabilesEntre(desde: Date, hasta: Date, cal: Calendario): number {
  const [ini, fin] = franja(cal);
  const a = aLocal(desde);
  const b = aLocal(hasta);
  if (b <= a) return 0;
  let total = 0;
  for (let i = 0, dia = inicioDia(a); i < MAX_DIAS && dia <= b; i++, dia += DIA_MS) {
    if (!esDiaHabil(dia, cal)) continue;
    total += Math.max(0, Math.min(b, dia + fin) - Math.max(a, dia + ini));
  }
  return Math.floor(total / 60_000);
}

/** Suma `horas` corridas salteando por completo los días no hábiles. */
export function sumarHorasEnDiasHabiles(inicio: Date, horas: number, cal: Calendario): Date {
  franja(cal);
  let t = aLocal(inicio);
  let resta = Math.max(0, horas) * 3600_000;
  for (let i = 0; i < MAX_DIAS; i++) {
    const dia = inicioDia(t);
    if (esDiaHabil(dia, cal)) {
      const disponible = dia + DIA_MS - t;
      if (resta <= disponible) return desdeLocal(t + resta);
      resta -= disponible;
    }
    t = dia + DIA_MS;
  }
  throw new Error('No se pudo calcular la fecha: revise el calendario hábil');
}

export type SemaforoSla = 'ok' | 'por_vencer' | 'vencido' | 'pausado' | 'cumplido';
export const UMBRAL_POR_VENCER = 0.8;

export interface DatosSla {
  creadoAt: Date;
  venceAt: Date | null;
  /** SLA total en minutos hábiles */
  totalMin: number;
  enEsperaDesde: Date | null;
  /** Momento en que se cumplió (resolución o primera respuesta) */
  cumplidoAt: Date | null;
}

/** Consumo del SLA (0..1+) y semáforo. Mientras está en espera el reloj queda detenido. */
export function estadoSla(d: DatosSla, ahora: Date, cal: Calendario) {
  if (!d.venceAt || d.totalMin <= 0)
    return { semaforo: 'ok' as SemaforoSla, consumido: 0, restanteMin: 0 };
  const ref = d.cumplidoAt ?? d.enEsperaDesde ?? ahora;
  const vencido = ref.getTime() > d.venceAt.getTime();
  const restanteMin = vencido
    ? -minutosHabilesEntre(d.venceAt, ref, cal)
    : minutosHabilesEntre(ref, d.venceAt, cal);
  const consumido = Math.max(0, (d.totalMin - restanteMin) / d.totalMin);
  let semaforo: SemaforoSla = 'ok';
  if (vencido) semaforo = 'vencido';
  else if (d.cumplidoAt) semaforo = 'cumplido';
  else if (d.enEsperaDesde) semaforo = 'pausado';
  else if (consumido >= UMBRAL_POR_VENCER) semaforo = 'por_vencer';
  return { semaforo, consumido, restanteMin };
}
