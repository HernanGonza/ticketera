import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ErrorApiCliente } from '../src/lib/api';
import type { DatosKanban } from '../src/lib/cache';
import { claves, qKanban } from '../src/lib/consultas';
import { buscarTicket, MENSAJE_CONFLICTO, mutarTicket } from '../src/lib/optimista';
import { ticket } from './ayudas';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

function preparar(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  qc.getQueryCache().build(qc, qc.defaultQueryOptions(qKanban));
  qc.setQueryData<DatosKanban>(claves.kanban, { tickets: [ticket({ id })] });
  return qc;
}

describe('mutaciones optimistas', () => {
  it('aplica al instante y confirma con la versión del servidor', async () => {
    const qc = preparar('ok');
    const p = mutarTicket(qc, {
      id: 'ok',
      parche: { prioridad: 'alta' },
      enviar: async (v) => ticket({ id: 'ok', prioridad: 'alta', version: v + 1 }),
    });
    expect(buscarTicket(qc, 'ok')?.prioridad).toBe('alta');
    await p;
    expect(buscarTicket(qc, 'ok')?.version).toBe(2);
  });

  it('encola cambios del mismo ticket usando la versión confirmada', async () => {
    const qc = preparar('cola');
    const versiones: number[] = [];
    const enviar = async (v: number) => {
      versiones.push(v);
      return ticket({ id: 'cola', version: v + 1 });
    };
    await Promise.all([
      mutarTicket(qc, { id: 'cola', parche: { prioridad: 'alta' }, enviar }),
      mutarTicket(qc, { id: 'cola', parche: { estado: 'en_curso' }, enviar }),
    ]);
    expect(versiones).toEqual([1, 2]);
  });

  it('ante conflicto revierte, muestra el aviso y deja el ticket del servidor', async () => {
    const qc = preparar('x');
    const servidor = ticket({ id: 'x', version: 4, estado: 'en_espera' });
    const segundo = vi.fn();
    const [a] = await Promise.all([
      mutarTicket(qc, {
        id: 'x',
        parche: { estado: 'asignado' },
        enviar: async () => {
          throw new ErrorApiCliente(409, 'conflicto_version', 'x', { ticket: servidor });
        },
      }),
      mutarTicket(qc, { id: 'x', parche: { prioridad: 'critica' }, enviar: segundo }),
    ]);
    expect(a).toBeNull();
    expect(segundo).not.toHaveBeenCalled();
    expect(buscarTicket(qc, 'x')).toMatchObject({ version: 4, estado: 'en_espera', prioridad: 'media' });
    expect(toast.warning).toHaveBeenCalledWith(MENSAJE_CONFLICTO, expect.anything());
  });

  it('ante otro error vuelve al valor anterior', async () => {
    const qc = preparar('e');
    await mutarTicket(qc, {
      id: 'e',
      parche: { prioridad: 'critica' },
      enviar: async () => {
        throw new ErrorApiCliente(500, 'interno', 'falló');
      },
    });
    expect(buscarTicket(qc, 'e')?.prioridad).toBe('media');
  });
});
