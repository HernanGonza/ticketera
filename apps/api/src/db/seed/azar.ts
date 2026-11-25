/** Generador pseudoaleatorio determinista (mulberry32). */
export function crearAzar(semilla: number) {
  let a = semilla >>> 0;
  const num = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entero = (min: number, max: number) => min + Math.floor(num() * (max - min + 1));
  const hex = (n: number) => Array.from({ length: n }, () => entero(0, 15).toString(16)).join('');
  return {
    num,
    entero,
    entre: (min: number, max: number) => min + num() * (max - min),
    prob: (p: number) => num() < p,
    elegir: <T>(lista: readonly T[]): T => lista[Math.floor(num() * lista.length)] as T,
    /** `pesos[i]` es el peso relativo de `lista[i]`. */
    pesado<T>(lista: readonly T[], pesos: readonly number[]): T {
      let resto = num() * lista.reduce((s, _, i) => s + (pesos[i] ?? 1), 0);
      for (const [i, v] of lista.entries()) {
        resto -= pesos[i] ?? 1;
        if (resto < 0) return v;
      }
      return lista[lista.length - 1] as T;
    },
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${entero(8, 11).toString(16)}${hex(3)}-${hex(12)}`,
  };
}
export type Azar = ReturnType<typeof crearAzar>;
