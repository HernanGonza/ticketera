import { useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus } from 'lucide-react';
import { formatearDuracion } from '@eco/shared/dominio';
import type { Catalogo, Categoria } from '@eco/shared/schemas';
import { IconoCategoria } from '../../componentes/IconoCategoria';
import { Boton, Encabezado, ErrorVista, Esqueletos, EstadoVacio } from '../../componentes/ui/basicos';
import { api } from '../../lib/api';
import { claves, qCatalogo } from '../../lib/consultas';
import { EditorCategoria } from './EditorCategoria';

export function Categorias() {
  const qc = useQueryClient();
  const consulta = useQuery(qCatalogo);
  const [editando, setEditando] = useState<Categoria | 'nueva' | null>(null);
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const refrescar = () => qc.invalidateQueries({ queryKey: claves.catalogo });
  const ordenar = useMutation({
    mutationFn: (ids: number[]) => api('/api/admin/categorias/orden', { metodo: 'PUT', cuerpo: { ids } }),
    onMutate: (ids) =>
      qc.setQueryData<Catalogo>(claves.catalogo, (c) =>
        c ? { ...c, categorias: c.categorias.map((x) => ({ ...x, orden: ids.indexOf(x.id) })) } : c,
      ),
    onSettled: refrescar,
  });
  const activar = useMutation({
    mutationFn: ({ id, orden: _o, ...c }: Categoria) =>
      c.activa
        ? api(`/api/admin/categorias/${id}`, { metodo: 'PUT', cuerpo: c })
        : api(`/api/admin/categorias/${id}`, { metodo: 'DELETE' }),
    onSettled: refrescar,
  });

  if (consulta.isPending) return <Esqueletos filas={8} alto="h-14" />;
  if (!consulta.data) return <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />;
  const lista = [...consulta.data.categorias].sort((a, b) => a.orden - b.orden);

  const alSoltar = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = lista.map((c) => c.id);
    ordenar.mutate(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))));
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Encabezado
        titulo="Categorías"
        acciones={
          <Boton onClick={() => setEditando('nueva')}>
            <Plus aria-hidden className="size-4" /> Nueva categoría
          </Boton>
        }
      >
        Arrastre para cambiar el orden en que se muestran.
      </Encabezado>
      {!lista.length && <EstadoVacio titulo="Todavía no hay categorías" />}
      <DndContext
        sensors={sensores}
        collisionDetection={closestCenter}
        onDragEnd={alSoltar}
        accessibility={{
          screenReaderInstructions: { draggable: 'Presione espacio para tomar la categoría, use las flechas para moverla y espacio para soltarla. Escape cancela.' },
          announcements: {
            onDragStart: () => 'Categoría tomada.',
            onDragOver: ({ over }) => (over ? `Posición ${lista.findIndex((c) => c.id === over.id) + 1} de ${lista.length}.` : undefined),
            onDragEnd: () => 'Categoría soltada.',
            onDragCancel: () => 'Movimiento cancelado.',
          },
        }}
      >
        <SortableContext items={lista.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {lista.map((c) => (
              <Fila
                key={c.id}
                categoria={c}
                padre={lista.find((p) => p.id === c.padreId)?.nombre}
                editar={() => setEditando(c)}
                alternar={() => {
                  if (!c.activa || window.confirm(`¿Desactivar la categoría «${c.nombre}»? Dejará de ofrecerse para nuevos pedidos.`))
                    activar.mutate({ ...c, activa: !c.activa });
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {editando && (
        <EditorCategoria categoria={editando === 'nueva' ? null : editando} catalogo={consulta.data} cerrar={() => setEditando(null)} />
      )}
    </div>
  );
}

function Fila({ categoria: c, padre, editar, alternar }: { categoria: Categoria; padre?: string; editar: () => void; alternar: () => void }) {
  const s = useSortable({ id: c.id });
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      data-testid={`fila-categoria-${c.id}`}
      className={`tarjeta flex flex-wrap items-center gap-3 p-3 ${s.isDragging ? 'relative z-10 shadow-alta' : ''}`}
    >
      <button type="button" ref={s.setActivatorNodeRef} {...s.attributes} {...s.listeners} className="cursor-grab touch-none rounded-sm p-1 text-suave" aria-label={`Reordenar ${c.nombre}`}>
        <GripVertical aria-hidden className="size-5" />
      </button>
      <IconoCategoria nombre={c.icono} className="size-5 text-primario" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {padre ? `${padre} › ` : ''}
          {c.nombre}
          {!c.activa && <span className="ml-2 rounded-full bg-superficie-2 px-2 py-0.5 text-xs">Inactiva</span>}
        </p>
        <p className="text-xs text-suave">
          Respuesta {formatearDuracion(c.slaRespuestaMin)} · Resolución {formatearDuracion(c.slaResolucionMin)} · {c.campos.length} campo(s) extra
        </p>
      </div>
      <Boton variante="secundario" tamano="sm" onClick={editar}>
        Editar
      </Boton>
      <Boton variante="fantasma" tamano="sm" onClick={alternar}>
        {c.activa ? 'Desactivar' : 'Activar'}
      </Boton>
    </li>
  );
}
