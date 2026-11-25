import type { UseFormRegisterReturn } from 'react-hook-form';
import type { CampoExtra } from '@eco/shared/schemas';
import { Campo } from './ui/basicos';

/** Controles de los campos configurados en la categoría (usado al pedir y en la vista previa). */
export function CamposExtra({
  campos,
  registrar,
  errores,
}: {
  campos: readonly CampoExtra[];
  registrar?: (clave: string) => UseFormRegisterReturn;
  errores?: Record<string, { message?: string } | undefined>;
}) {
  return campos.map((c) => {
    const error = errores?.[c.clave]?.message;
    const reg = registrar?.(c.clave);
    if (c.tipo === 'casilla')
      return (
        <div key={c.clave}>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-0.5 size-5 accent-primario" {...reg} aria-invalid={error ? true : undefined} />
            <span>
              {c.etiqueta}
              {c.requerido && <span className="text-peligro"> *</span>}
              {c.ayuda && <span className="block text-xs font-normal text-suave">{c.ayuda}</span>}
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
        </div>
      );
    return (
      <Campo key={c.clave} etiqueta={c.etiqueta} ayuda={c.ayuda} requerido={c.requerido} error={error}>
        {(p) =>
          c.tipo === 'texto_largo' ? (
            <textarea rows={3} className="entrada" {...p} {...reg} />
          ) : c.tipo === 'seleccion' ? (
            <select className="entrada" {...p} {...reg}>
              <option value="">Elija una opción…</option>
              {c.opciones?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="entrada"
              type={c.tipo === 'fecha' ? 'date' : 'text'}
              inputMode={c.tipo === 'numero' ? 'decimal' : undefined}
              {...p}
              {...reg}
            />
          )
        }
      </Campo>
    );
  });
}
