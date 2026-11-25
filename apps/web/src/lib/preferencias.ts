import { crearAlmacen, guardado } from './almacen';

export interface Preferencias {
  tema: 'claro' | 'oscuro';
  sonido: boolean;
  notificaciones: boolean;
  menuColapsado: boolean;
}
const DEFECTO: Preferencias = { tema: 'claro', sonido: false, notificaciones: false, menuColapsado: false };

export const preferencias = crearAlmacen<Preferencias>({ ...DEFECTO, ...guardado.leer('preferencias', {}) });

export function aplicarTema(tema: Preferencias['tema']) {
  document.documentElement.dataset.theme = tema === 'oscuro' ? 'dark' : 'light';
}
export function cambiarPreferencias(c: Partial<Preferencias>) {
  preferencias.fijar((p) => ({ ...p, ...c }));
  guardado.escribir('preferencias', preferencias.leer());
  if (c.tema) aplicarTema(c.tema);
}
