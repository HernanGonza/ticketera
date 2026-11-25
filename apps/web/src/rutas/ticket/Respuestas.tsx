import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import type { RespuestaRapida } from '@eco/shared/schemas';
import { Boton, Campo } from '../../componentes/ui/basicos';
import { Dialogo } from '../../componentes/ui/flotantes';
import { api } from '../../lib/api';
import { claves } from '../../lib/consultas';
import { useCatalogo } from '../../lib/hooks';

export function RespuestasRapidas({ cerrar }: { cerrar: () => void }) {
  const qc = useQueryClient();
  const lista = useCatalogo()?.respuestasRapidas ?? [];
  const [actual, setActual] = useState<Partial<RespuestaRapida>>({});
  const refrescar = () => qc.invalidateQueries({ queryKey: claves.catalogo });
  const guardar = useMutation({
    mutationFn: ({ id, ...cuerpo }: Partial<RespuestaRapida>) =>
      api(`/api/admin/respuestas${id ? `/${id}` : ''}`, { metodo: id ? 'PUT' : 'POST', cuerpo }),
    onSuccess: () => {
      setActual({});
      return refrescar();
    },
  });
  const borrar = useMutation({
    mutationFn: (id: number) => api(`/api/admin/respuestas/${id}`, { metodo: 'DELETE' }),
    onSuccess: refrescar,
  });
  return (
    <Dialogo abierto cerrar={cerrar} titulo="Respuestas rápidas">
      <ul className="mb-4 flex flex-col gap-2">
        {!lista.length && <li className="text-sm text-suave">Todavía no hay respuestas guardadas.</li>}
        {lista.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-md border border-borde p-2 text-sm">
            <span className="min-w-0 flex-1">
              <strong className="block">{r.titulo}</strong>
              <span className="block truncate text-suave">{r.cuerpo}</span>
            </span>
            <Boton variante="fantasma" tamano="iconoSm" aria-label={`Editar ${r.titulo}`} onClick={() => setActual(r)}>
              <Pencil aria-hidden className="size-4" />
            </Boton>
            <Boton
              variante="fantasma"
              tamano="iconoSm"
              aria-label={`Eliminar ${r.titulo}`}
              onClick={() => window.confirm(`¿Eliminar la respuesta «${r.titulo}»?`) && borrar.mutate(r.id)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Boton>
          </li>
        ))}
      </ul>
      {/* No es un <form> anidado dentro del redactor: el diálogo se monta en un portal. */}
      <form
        className="flex flex-col gap-3 border-t border-borde pt-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          e.stopPropagation();
          guardar.mutate(actual);
        }}
      >
        <h3 className="font-bold">{actual.id ? 'Editar respuesta' : 'Nueva respuesta'}</h3>
        <Campo etiqueta="Título">
          {(p) => <input {...p} className="entrada" required minLength={2} maxLength={80} value={actual.titulo ?? ''} onChange={(e) => setActual({ ...actual, titulo: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Texto">
          {(p) => <textarea {...p} className="entrada" rows={3} required maxLength={5000} value={actual.cuerpo ?? ''} onChange={(e) => setActual({ ...actual, cuerpo: e.target.value })} />}
        </Campo>
        <div className="flex justify-end gap-2">
          {actual.id && (
            <Boton variante="secundario" onClick={() => setActual({})}>
              Cancelar edición
            </Boton>
          )}
          <Boton type="submit" ocupado={guardar.isPending}>
            Guardar
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
