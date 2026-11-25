import { useQueryClient } from '@tanstack/react-query';
import {
  ETIQUETA_ESTADO,
  ETIQUETA_PRIORIDAD,
  PRIORIDADES,
  transicionesPosibles,
  type Estado,
  type Prioridad,
} from '@eco/shared/dominio';
import type { TicketDetalle, UsuarioActual } from '@eco/shared/schemas';
import { Boton, Campo } from '../../componentes/ui/basicos';
import { asignar, cambiarCategoria, cambiarEstado, cambiarPrioridad } from '../../lib/acciones';
import { useCatalogo } from '../../lib/hooks';

export function Gestion({ ticket: t, usuario }: { ticket: TicketDetalle; usuario: UsuarioActual }) {
  const qc = useQueryClient();
  const catalogo = useCatalogo();
  const estados = transicionesPosibles(t.estado, {
    rol: usuario.rol,
    esSolicitante: t.solicitante.id === usuario.id,
    tieneAsignado: !!t.asignado,
  });
  const tecnicos = catalogo?.tecnicos ?? [];
  const categorias = (catalogo?.categorias ?? []).filter((c) => c.activa || c.id === t.categoriaId);
  return (
    <section className="tarjeta flex flex-col gap-3 p-4">
      <h2>Gestión</h2>
      <Campo etiqueta="Estado">
        {(p) => (
          <select {...p} data-testid="gestion-estado" className="entrada" value={t.estado} disabled={!estados.length} onChange={(e) => void cambiarEstado(qc, t, e.target.value as Estado, usuario)}>
            {[t.estado, ...estados].map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        )}
      </Campo>
      <Campo etiqueta="Prioridad">
        {(p) => (
          <select {...p} data-testid="gestion-prioridad" className="entrada" value={t.prioridad} onChange={(e) => void cambiarPrioridad(qc, t, e.target.value as Prioridad)}>
            {PRIORIDADES.map((x) => (
              <option key={x} value={x}>
                {ETIQUETA_PRIORIDAD[x]}
              </option>
            ))}
          </select>
        )}
      </Campo>
      <Campo etiqueta="Categoría">
        {(p) => (
          <select
            {...p}
            data-testid="gestion-categoria"
            className="entrada"
            value={t.categoriaId}
            onChange={(e) => {
              const c = categorias.find((x) => x.id === Number(e.target.value));
              if (c) void cambiarCategoria(qc, t, c);
            }}
          >
            {!categorias.some((c) => c.id === t.categoriaId) && <option value={t.categoriaId}>{t.categoriaNombre}</option>}
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        )}
      </Campo>
      <Campo etiqueta="Asignado a">
        {(p) => (
          <select
            {...p}
            data-testid="gestion-asignado"
            className="entrada"
            value={t.asignado?.id ?? ''}
            onChange={(e) => void asignar(qc, t, tecnicos.find((x) => x.id === e.target.value) ?? null)}
          >
            <option value="">Sin asignar</option>
            {t.asignado && !tecnicos.some((x) => x.id === t.asignado?.id) && <option value={t.asignado.id}>{t.asignado.nombre}</option>}
            {tecnicos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </select>
        )}
      </Campo>
      {t.asignado?.id !== usuario.id && (
        <Boton variante="secundario" tamano="sm" onClick={() => void asignar(qc, t, { id: usuario.id, nombre: usuario.nombre })}>
          Asignarme este pedido
        </Boton>
      )}
    </section>
  );
}
