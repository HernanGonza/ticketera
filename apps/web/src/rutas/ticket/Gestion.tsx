import { useRef, useState, type ComponentProps } from 'react';
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

type PropsSelector = Omit<ComponentProps<'select'>, 'value' | 'onChange'> & {
  value: string | number;
  elegir: (valor: string) => void;
};

/** Con el mouse aplica al elegir; recorriendo con las flechas espera Enter o salir del campo (Escape descarta). */
function SelectorSeguro({ value, elegir, ...p }: PropsSelector) {
  const [pendiente, setPendiente] = useState<string | null>(null);
  const teclado = useRef(false);
  const aplicar = () => {
    if (pendiente !== null && pendiente !== String(value)) elegir(pendiente);
    setPendiente(null);
  };
  return (
    <>
      <select
        {...p}
        value={pendiente ?? value}
        onPointerDown={() => (teclado.current = false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') aplicar();
          else if (e.key === 'Escape') setPendiente(null);
          else if (e.key !== 'Tab') teclado.current = true;
        }}
        onChange={(e) => (teclado.current ? setPendiente(e.target.value) : elegir(e.target.value))}
        onBlur={aplicar}
      />
      {pendiente !== null && pendiente !== String(value) && (
        <span role="status" className="text-xs text-suave">
          Presione Enter para aplicar o Escape para descartar.
        </span>
      )}
    </>
  );
}

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
      <h2 className="sr-only">Gestión</h2>
      <Campo etiqueta="Estado">
        {(p) => (
          <SelectorSeguro {...p} data-testid="gestion-estado" className="entrada" value={t.estado} disabled={!estados.length} elegir={(v) => void cambiarEstado(qc, t, v as Estado, usuario)}>
            {[t.estado, ...estados].map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </SelectorSeguro>
        )}
      </Campo>
      <Campo etiqueta="Prioridad">
        {(p) => (
          <SelectorSeguro {...p} data-testid="gestion-prioridad" className="entrada" value={t.prioridad} elegir={(v) => void cambiarPrioridad(qc, t, v as Prioridad)}>
            {PRIORIDADES.map((x) => (
              <option key={x} value={x}>
                {ETIQUETA_PRIORIDAD[x]}
              </option>
            ))}
          </SelectorSeguro>
        )}
      </Campo>
      <Campo etiqueta="Categoría">
        {(p) => (
          <SelectorSeguro
            {...p}
            data-testid="gestion-categoria"
            className="entrada"
            value={t.categoriaId}
            elegir={(v) => {
              const c = categorias.find((x) => x.id === Number(v));
              if (c) void cambiarCategoria(qc, t, c);
            }}
          >
            {!categorias.some((c) => c.id === t.categoriaId) && <option value={t.categoriaId}>{t.categoriaNombre}</option>}
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </SelectorSeguro>
        )}
      </Campo>
      <Campo etiqueta="Asignado a">
        {(p) => (
          <SelectorSeguro
            {...p}
            data-testid="gestion-asignado"
            className="entrada"
            value={t.asignado?.id ?? ''}
            elegir={(v) => void asignar(qc, t, tecnicos.find((x) => x.id === v) ?? null)}
          >
            <option value="">Sin asignar</option>
            {t.asignado && !tecnicos.some((x) => x.id === t.asignado?.id) && <option value={t.asignado.id}>{t.asignado.nombre}</option>}
            {tecnicos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </SelectorSeguro>
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
