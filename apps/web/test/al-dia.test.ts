import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { SALAS } from '@eco/shared/realtime';
import { ponerAlDia } from '../src/lib/al-dia';
import { claves } from '../src/lib/consultas';

/** Consulta activa cuyas respuestas se entregan a mano. */
function observada(qc: QueryClient, queryKey: readonly unknown[]) {
  const pendientes: ((v: number) => void)[] = [];
  const o = new QueryObserver(qc, { queryKey, queryFn: () => new Promise<number>((ok) => pendientes.push(ok)) });
  const soltar = o.subscribe(() => {});
  return { pendientes, soltar };
}
const turno = () => new Promise((ok) => setTimeout(ok, 0));

describe('puesta al día al entrar a una sala', () => {
  it('vuelve a pedir lo ya cargado', async () => {
    const qc = new QueryClient();
    const c = observada(qc, claves.kanban);
    c.pendientes[0]!(1);
    await turno();
    const listo = ponerAlDia(qc, SALAS.tecnicos);
    await turno();
    expect(c.pendientes).toHaveLength(2);
    c.pendientes[1]!(2);
    await listo;
    expect(qc.getQueryData(claves.kanban)).toBe(2);
    c.soltar();
  });

  it('no cancela el pedido en curso y pide otro cuando termina', async () => {
    const qc = new QueryClient();
    const c = observada(qc, claves.mensajes('abc'));
    const listo = ponerAlDia(qc, SALAS.ticket('abc'));
    await turno();
    expect(c.pendientes).toHaveLength(1);
    c.pendientes[0]!(1);
    await turno();
    expect(qc.getQueryData(claves.mensajes('abc'))).toBe(1);
    expect(c.pendientes).toHaveLength(2);
    c.pendientes[1]!(2);
    await listo;
    expect(qc.getQueryData(claves.mensajes('abc'))).toBe(2);
    c.soltar();
  });
});
