import { useSyncExternalStore } from 'react';

/** Almacén mínimo para estado efímero fuera de React (conexión, presencia, preferencias). */
export function crearAlmacen<T>(inicial: T) {
  let valor = inicial;
  const oyentes = new Set<() => void>();
  const almacen = {
    leer: () => valor,
    fijar(nuevo: T | ((v: T) => T)) {
      const siguiente = typeof nuevo === 'function' ? (nuevo as (v: T) => T)(valor) : nuevo;
      if (Object.is(siguiente, valor)) return;
      valor = siguiente;
      oyentes.forEach((f) => f());
    },
    suscribir(f: () => void) {
      oyentes.add(f);
      return () => {
        oyentes.delete(f);
      };
    },
  };
  return almacen;
}
export type Almacen<T> = ReturnType<typeof crearAlmacen<T>>;

/** El selector debe devolver un valor estable (primitivo o referencia ya existente). */
export function useAlmacen<T, S = T>(a: Almacen<T>, selector: (v: T) => S = (v) => v as unknown as S): S {
  return useSyncExternalStore(a.suscribir, () => selector(a.leer()));
}

/** localStorage tolerante a navegadores que lo bloquean. */
export const guardado = {
  leer<T>(clave: string, porDefecto: T): T {
    try {
      const v = localStorage.getItem(`eco.${clave}`);
      return v === null ? porDefecto : (JSON.parse(v) as T);
    } catch {
      return porDefecto;
    }
  },
  escribir(clave: string, v: unknown) {
    try {
      localStorage.setItem(`eco.${clave}`, JSON.stringify(v));
    } catch {
      /* sin persistencia */
    }
  },
};
