/** Genera el favicon (Flor del Lapacho) con los colores definidos en tokens.css. */
const PETALO = 'M50 50 C37 41 28 22 36 11 C41 5 47 8 50 12 C53 8 59 5 64 11 C72 22 63 41 50 50Z';

/** @param {string} tokens contenido de tokens.css */
export function svgFavicon(tokens) {
  const token = (nombre) => {
    const m = tokens.match(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{3,8})`));
    if (!m) throw new Error(`Falta --${nombre} en tokens.css`);
    return m[1];
  };
  const centro = token('eco-lapacho');
  const borde = token('eco-lapacho-claro');
  const blanco = token('eco-blanco');
  const petalos = [0, 72, 144, 216, 288]
    .map((g) => `<path transform="rotate(${g} 50 50)" d="${PETALO}" fill="url(#g)"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 1 94 94"><defs><radialGradient id="g" cx="50" cy="50" r="42" gradientUnits="userSpaceOnUse"><stop offset=".1" stop-color="${centro}"/><stop offset="1" stop-color="${borde}"/></radialGradient></defs>${petalos}<circle cx="50" cy="50" r="6" fill="${blanco}"/></svg>`;
}
