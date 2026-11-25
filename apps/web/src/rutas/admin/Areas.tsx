import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Area } from '@eco/shared/schemas';
import { Boton, Campo, Encabezado, ErrorVista, Esqueletos, EstadoVacio } from '../../componentes/ui/basicos';
import { Dialogo } from '../../componentes/ui/flotantes';
import { api } from '../../lib/api';
import { claves, qCatalogo } from '../../lib/consultas';

export function Areas() {
  const qc = useQueryClient();
  const consulta = useQuery(qCatalogo);
  const [nombre, setNombre] = useState('');
  const [editando, setEditando] = useState<Area | null>(null);
  const guardar = useMutation({
    mutationFn: ({ id, ...cuerpo }: Partial<Area>) =>
      api(`/api/admin/areas${id ? `/${id}` : ''}`, { metodo: id ? 'PUT' : 'POST', cuerpo }),
    onSuccess: () => {
      toast.success('Área guardada.');
      setNombre('');
      setEditando(null);
      return qc.invalidateQueries({ queryKey: claves.catalogo });
    },
  });
  if (consulta.isPending) return <Esqueletos filas={6} alto="h-12" />;
  if (!consulta.data) return <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />;
  const areas = [...consulta.data.areas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return (
    <div className="mx-auto max-w-3xl">
      <Encabezado titulo="Áreas" />
      <form
        className="tarjeta mb-4 flex flex-wrap items-end gap-2 p-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (nombre.trim().length >= 2) guardar.mutate({ nombre: nombre.trim(), activo: true });
        }}
      >
        <Campo etiqueta="Nueva área" className="min-w-60 flex-1">
          {(p) => <input {...p} className="entrada" required minLength={2} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Campo>
        <Boton type="submit" ocupado={guardar.isPending && !editando}>
          Agregar
        </Boton>
      </form>
      {!areas.length ? (
        <EstadoVacio titulo="Todavía no hay áreas" />
      ) : (
        <ul className="tarjeta divide-y divide-borde">
          {areas.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1 font-semibold">
                {a.nombre}
                {!a.activo && <span className="ml-2 rounded-full bg-superficie-2 px-2 py-0.5 text-xs">Inactiva</span>}
              </span>
              <Boton variante="secundario" tamano="sm" aria-label={`Editar ${a.nombre}`} onClick={() => setEditando(a)}>
                Editar
              </Boton>
              <Boton variante="fantasma" tamano="sm" onClick={() => guardar.mutate({ ...a, activo: !a.activo })}>
                {a.activo ? 'Desactivar' : 'Activar'}
              </Boton>
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <Dialogo abierto cerrar={() => setEditando(null)} titulo="Editar área">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              guardar.mutate({ ...editando, nombre: editando.nombre.trim() });
            }}
          >
            <Campo etiqueta="Nombre">
              {(p) => <input {...p} className="entrada" required minLength={2} maxLength={120} value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />}
            </Campo>
            <div className="flex justify-end gap-2">
              <Boton variante="secundario" onClick={() => setEditando(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" ocupado={guardar.isPending}>
                Guardar
              </Boton>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  );
}
