import { crearAlmacen, guardado } from './almacen';

export interface Preferencias {
  tema: 'claro' | 'oscuro';
  sonido: boolean;
  notificaciones: boolean;
  menuColapsado: boolean;
  /** Atajos de una sola tecla en el tablero. */
  atajos: boolean;
}
const DEFECTO: Preferencias = { tema: 'claro', sonido: false, notificaciones: false, menuColapsado: false, atajos: true };

export const preferencias = crearAlmacen<Preferencias>({ ...DEFECTO, ...guardado.leer('preferencias', {}) });

export function aplicarTema(tema: Preferencias['tema']) {
  document.documentElement.dataset.theme = tema === 'oscuro' ? 'dark' : 'light';
}
export function cambiarPreferencias(c: Partial<Preferencias>) {
  preferencias.fijar((p) => ({ ...p, ...c }));
  guardado.escribir('preferencias', preferencias.leer());
  if (c.tema) aplicarTema(c.tema);
}
