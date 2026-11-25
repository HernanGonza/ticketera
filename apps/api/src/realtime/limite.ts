/** Cubeta de fichas: permite ráfagas de `capacidad` y repone esa cantidad cada `periodoMs`. */
export function crearLimite(capacidad: number, periodoMs: number, ahora: () => number = Date.now) {
  let fichas = capacidad;
  let ultimo = ahora();
  return (): boolean => {
    const t = ahora();
    fichas = Math.min(capacidad, fichas + ((t - ultimo) * capacidad) / periodoMs);
    ultimo = t;
    if (fichas < 1) return false;
    fichas -= 1;
    return true;
  };
}
