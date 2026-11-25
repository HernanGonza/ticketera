import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ETIQUETA_PRIORIDAD, PRIORIDADES, formatearDuracion, type Prioridad } from '@eco/shared/dominio';
import type { Catalogo, Categoria, GuardarCategoria } from '@eco/shared/schemas';
import { CamposExtra } from '../../componentes/CamposExtra';
import { ICONOS, type NombreIcono } from '../../componentes/IconoCategoria';
import { Boton, Campo } from '../../componentes/ui/basicos';
import { Dialogo } from '../../componentes/ui/flotantes';
import { api } from '../../lib/api';
import { aCampos, validarCategoria, type CampoEditable } from '../../lib/categorias';
import { claves } from '../../lib/consultas';

type Tipo = CampoEditable['tipo'];
const TIPOS: Record<Tipo, string> = {
  texto: 'Texto corto',
  texto_largo: 'Texto largo',
  numero: 'Número',
  seleccion: 'Lista de opciones',
  casilla: 'Casilla de verificación',
  fecha: 'Fecha',
};
let contador = 0;
const uid = () => `campo-${++contador}`;

export function EditorCategoria({ categoria, catalogo, cerrar }: { categoria: Categoria | null; catalogo: Catalogo; cerrar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    nombre: categoria?.nombre ?? '',
    descripcion: categoria?.descripcion ?? '',
    icono: categoria?.icono ?? 'circle-help',
    padreId: categoria?.padreId ?? null,
    prioridadDefault: categoria?.prioridadDefault ?? ('media' as Prioridad),
    slaRespuestaMin: categoria?.slaRespuestaMin ?? 240,
    slaResolucionMin: categoria?.slaResolucionMin ?? 1440,
    modoAsignacion: categoria?.modoAsignacion ?? ('manual' as const),
    tecnicoDefaultId: categoria?.tecnicoDefaultId ?? null,
    activa: categoria?.activa ?? true,
  }));
  const [campos, setCampos] = useState<CampoEditable[]>(() =>
    (categoria?.campos ?? []).map((c) => ({ ...c, opcionesTexto: c.opciones?.join('\n') ?? '', uid: uid(), guardado: true })),
  );
  const [errores, setErrores] = useState<string[]>([]);
  const poner = (c: Partial<typeof f>) => setF((v) => ({ ...v, ...c }));
  const campo = (i: number, c: Partial<CampoEditable>) => setCampos((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const mover = (i: number, d: -1 | 1) =>
    setCampos((l) => {
      const r = [...l];
      const [x] = r.splice(i, 1);
      r.splice(i + d, 0, x!);
      return r;
    });

  const guardar = useMutation({
    mutationFn: (cuerpo: GuardarCategoria) =>
      api(`/api/admin/categorias${categoria ? `/${categoria.id}` : ''}`, { metodo: categoria ? 'PUT' : 'POST', cuerpo }),
    onSuccess: () => {
      toast.success('Categoría guardada.');
      cerrar();
      return qc.invalidateQueries({ queryKey: claves.catalogo });
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const cuerpo: GuardarCategoria = {
      ...f,
      nombre: f.nombre.trim(),
      descripcion: f.descripcion.trim(),
      tecnicoDefaultId: f.modoAsignacion === 'fija' ? f.tecnicoDefaultId : null,
      campos: aCampos(campos),
    };
    const err = validarCategoria(cuerpo);
    setErrores(err);
    if (!err.length) guardar.mutate(cuerpo);
  };

  const minutos = (etiqueta: string, clave: 'slaRespuestaMin' | 'slaResolucionMin') => (
    <Campo etiqueta={etiqueta} ayuda={`Minutos hábiles (${formatearDuracion(f[clave] || 0)})`}>
      {(p) => <input {...p} type="number" min={5} max={100000} className="entrada" value={f[clave] || ''} onChange={(e) => poner({ [clave]: Number(e.target.value) })} />}
    </Campo>
  );

  return (
    <Dialogo abierto cerrar={cerrar} titulo={categoria ? `Editar ${categoria.nombre}` : 'Nueva categoría'} className="w-[min(96vw,56rem)]">
      <form noValidate onSubmit={enviar} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre" requerido>
            {(p) => <input {...p} className="entrada" maxLength={80} value={f.nombre} onChange={(e) => poner({ nombre: e.target.value })} />}
          </Campo>
          <Campo etiqueta="Descripción">
            {(p) => <input {...p} className="entrada" maxLength={200} value={f.descripcion} onChange={(e) => poner({ descripcion: e.target.value })} />}
          </Campo>
          <Campo etiqueta="Categoría superior">
            {(p) => (
              <select {...p} className="entrada" value={f.padreId ?? ''} onChange={(e) => poner({ padreId: Number(e.target.value) || null })}>
                <option value="">Ninguna</option>
                {catalogo.categorias
                  .filter((c) => c.id !== categoria?.id && c.padreId !== categoria?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Prioridad por defecto">
            {(p) => (
              <select {...p} className="entrada" value={f.prioridadDefault} onChange={(e) => poner({ prioridadDefault: e.target.value as Prioridad })}>
                {PRIORIDADES.map((x) => (
                  <option key={x} value={x}>
                    {ETIQUETA_PRIORIDAD[x]}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          {minutos('Plazo de primera respuesta', 'slaRespuestaMin')}
          {minutos('Plazo de resolución', 'slaResolucionMin')}
          <Campo etiqueta="Asignación automática">
            {(p) => (
              <select {...p} className="entrada" value={f.modoAsignacion} onChange={(e) => poner({ modoAsignacion: e.target.value as typeof f.modoAsignacion })}>
                <option value="manual">Manual</option>
                <option value="fija">Siempre a un técnico</option>
                <option value="round_robin">Rotativa por menor carga</option>
              </select>
            )}
          </Campo>
          {f.modoAsignacion === 'fija' && (
            <Campo etiqueta="Técnico">
              {(p) => (
                <select {...p} className="entrada" value={f.tecnicoDefaultId ?? ''} onChange={(e) => poner({ tecnicoDefaultId: e.target.value || null })}>
                  <option value="">Elija un técnico…</option>
                  {catalogo.tecnicos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          )}
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Ícono</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ICONOS) as NombreIcono[]).map((n) => {
              const I = ICONOS[n];
              return (
                <label key={n} title={n} className="flex size-10 cursor-pointer items-center justify-center rounded-md border border-borde-fuerte has-checked:border-primario has-checked:bg-primario has-checked:text-primario-texto has-focus-visible:outline-2 has-focus-visible:outline-foco">
                  <input type="radio" name="icono" className="sr-only" checked={f.icono === n} onChange={() => poner({ icono: n })} />
                  <I aria-hidden className="size-5" />
                  <span className="sr-only">{n}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-primario" checked={f.activa} onChange={(e) => poner({ activa: e.target.checked })} />
          Categoría activa
        </label>

        <div className="grid items-start gap-4 border-t border-borde pt-3 lg:grid-cols-2">
          <section aria-label="Campos extra">
            <h3 className="mb-2 font-bold">Campos extra del formulario</h3>
            <ol className="flex flex-col gap-3">
              {campos.map((c, i) => (
                <li key={c.uid} className="flex flex-col gap-2 rounded-md border border-borde p-3">
                  <Campo etiqueta={`Etiqueta del campo ${i + 1}`}>
                    {(p) => <input {...p} className="entrada" maxLength={80} value={c.etiqueta} onChange={(e) => campo(i, { etiqueta: e.target.value })} />}
                  </Campo>
                  <Campo etiqueta="Tipo">
                    {(p) => (
                      <select {...p} className="entrada" value={c.tipo} onChange={(e) => campo(i, { tipo: e.target.value as Tipo })}>
                        {Object.entries(TIPOS).map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </select>
                    )}
                  </Campo>
                  {c.tipo === 'seleccion' && (
                    <Campo etiqueta="Opciones" ayuda="Una por línea.">
                      {(p) => <textarea {...p} className="entrada" rows={3} value={c.opcionesTexto} onChange={(e) => campo(i, { opcionesTexto: e.target.value })} />}
                    </Campo>
                  )}
                  <Campo etiqueta="Texto de ayuda (opcional)">
                    {(p) => <input {...p} className="entrada" maxLength={200} value={c.ayuda ?? ''} onChange={(e) => campo(i, { ayuda: e.target.value })} />}
                  </Campo>
                  <div className="flex items-center gap-1">
                    <label className="mr-auto flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-primario" checked={c.requerido} onChange={(e) => campo(i, { requerido: e.target.checked })} />
                      Obligatorio
                    </label>
                    <Boton variante="fantasma" tamano="iconoSm" aria-label="Subir campo" disabled={i === 0} onClick={() => mover(i, -1)}>
                      <ArrowUp aria-hidden className="size-4" />
                    </Boton>
                    <Boton variante="fantasma" tamano="iconoSm" aria-label="Bajar campo" disabled={i === campos.length - 1} onClick={() => mover(i, 1)}>
                      <ArrowDown aria-hidden className="size-4" />
                    </Boton>
                    <Boton variante="fantasma" tamano="iconoSm" aria-label="Eliminar campo" onClick={() => setCampos((l) => l.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden className="size-4" />
                    </Boton>
                  </div>
                </li>
              ))}
            </ol>
            <Boton
              variante="secundario"
              tamano="sm"
              className="mt-2"
              disabled={campos.length >= 20}
              onClick={() => setCampos((l) => [...l, { uid: uid(), guardado: false, clave: '', etiqueta: '', tipo: 'texto', requerido: false, opcionesTexto: '' }])}
            >
              <Plus aria-hidden className="size-4" /> Agregar campo
            </Boton>
          </section>
          <section aria-label="Vista previa" className="rounded-lg bg-fondo p-3" data-testid="vista-previa">
            <h3 className="mb-2 font-bold">Vista previa</h3>
            <div className="flex flex-col gap-3">
              {campos.length ? <CamposExtra campos={aCampos(campos)} /> : <p className="text-sm text-suave">El formulario solo tendrá los campos generales.</p>}
            </div>
          </section>
        </div>
        {errores.length > 0 && (
          <ul role="alert" className="list-disc rounded-md bg-peligro-suave p-3 pl-6 text-sm text-peligro-sobre-suave">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={cerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" ocupado={guardar.isPending}>
            Guardar categoría
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
