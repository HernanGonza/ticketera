import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouteContext } from '@tanstack/react-router';
import { CALENDARIO_DEFAULT } from '@eco/shared/dominio';
import { qCatalogo } from './consultas';
import { qSesion } from './sesion';
import { unirSala } from './vivo';

/** Usuario autenticado; solo se usa dentro del armazón (la guarda ya lo cargó). */
export function useUsuario() {
  const inicial = useRouteContext({ from: '/app', select: (c) => c.usuario });
  return useQuery(qSesion).data ?? inicial;
}

export function useCatalogo() {
  return useQuery(qCatalogo).data;
}
export function useCalendario() {
  return useCatalogo()?.configuracion.calendario ?? CALENDARIO_DEFAULT;
}

/** Reloj compartido que avanza cada minuto (barras de SLA). */
let ahora = new Date();
const oyentes = new Set<() => void>();
let intervalo: ReturnType<typeof setInterval> | undefined;
function suscribirReloj(f: () => void) {
  oyentes.add(f);
  if (!intervalo) {
    ahora = new Date();
    intervalo = setInterval(() => {
      ahora = new Date();
      oyentes.forEach((o) => o());
    }, 60_000);
  }
  return () => {
    oyentes.delete(f);
    if (!oyentes.size) {
      clearInterval(intervalo);
      intervalo = undefined;
    }
  };
}
export const useAhora = () => useSyncExternalStore(suscribirReloj, () => ahora);

export function useSala(sala: string | undefined) {
  useEffect(() => (sala ? unirSala(sala) : undefined), [sala]);
}

export function useDiferido<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function useTitulo(titulo: string) {
  useEffect(() => {
    document.title = titulo;
  }, [titulo]);
}
