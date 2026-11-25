import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { Configuracion } from '@eco/shared/schemas';
import { Boton, Campo, Encabezado, ErrorVista, Esqueletos } from '../../componentes/ui/basicos';
import { api } from '../../lib/api';
import { claves, qCatalogo } from '../../lib/consultas';

const DIAS: [number, string][] = [
  [1, 'Lunes'],
  [2, 'Martes'],
  [3, 'Miércoles'],
  [4, 'Jueves'],
  [5, 'Viernes'],
  [6, 'Sábado'],
  [0, 'Domingo'],
];

export function PaginaConfiguracion() {
  const consulta = useQuery(qCatalogo);
  if (consulta.isPending) return <Esqueletos filas={5} alto="h-24" />;
  if (!consulta.data) return <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />;
  return <Formulario inicial={consulta.data.configuracion} />;
}

function Formulario({ inicial }: { inicial: Configuracion }) {
  const qc = useQueryClient();
  const [c, setC] = useState(inicial);
  const [feriado, setFeriado] = useState('');
  const [error, setError] = useState<string>();
  const cal = c.calendario;
  const calendario = (x: Partial<Configuracion['calendario']>) => setC((v) => ({ ...v, calendario: { ...v.calendario, ...x } }));
  const guardar = useMutation({
    mutationFn: () => api<Configuracion>('/api/admin/configuracion', { metodo: 'PUT', cuerpo: c }),
    onSuccess: () => {
      toast.success('Configuración guardada.');
      return qc.invalidateQueries({ queryKey: claves.catalogo });
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const fallo = !cal.dias.length
      ? 'Elija al menos un día hábil.'
      : cal.hasta <= cal.desde
        ? 'La hora de fin debe ser posterior a la de inicio.'
        : !(c.horasAutocierre >= 1 && c.horasAutocierre <= 720)
          ? 'Las horas de cierre automático deben estar entre 1 y 720.'
          : !(c.adjuntoMaxMb >= 1 && c.adjuntoMaxMb <= 50)
            ? 'El tamaño máximo debe estar entre 1 y 50 MB.'
            : undefined;
    setError(fallo);
    if (!fallo) guardar.mutate();
  };
  return (
    <div className="mx-auto max-w-3xl">
      <Encabezado titulo="Configuración">Horario hábil, feriados y reglas generales.</Encabezado>
      <form noValidate onSubmit={enviar} className="flex flex-col gap-4">
        <section className="tarjeta flex flex-col gap-3 p-4">
          <h2>Horario hábil</h2>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Días</legend>
            <div className="flex flex-wrap gap-3">
              {DIAS.map(([n, t]) => (
                <label key={n} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-primario"
                    checked={cal.dias.includes(n)}
                    onChange={(e) => calendario({ dias: e.target.checked ? [...cal.dias, n].sort() : cal.dias.filter((d) => d !== n) })}
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Campo etiqueta="Desde">
              {(p) => <input {...p} type="time" className="entrada" value={cal.desde} onChange={(e) => calendario({ desde: e.target.value })} />}
            </Campo>
            <Campo etiqueta="Hasta">
              {(p) => <input {...p} type="time" className="entrada" value={cal.hasta} onChange={(e) => calendario({ hasta: e.target.value })} />}
            </Campo>
          </div>
        </section>
        <section className="tarjeta flex flex-col gap-3 p-4">
          <h2>Feriados</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Campo etiqueta="Fecha">
              {(p) => <input {...p} type="date" className="entrada" value={feriado} onChange={(e) => setFeriado(e.target.value)} />}
            </Campo>
            <Boton
              variante="secundario"
              disabled={!feriado || cal.feriados.includes(feriado)}
              onClick={() => {
                calendario({ feriados: [...cal.feriados, feriado].sort() });
                setFeriado('');
              }}
            >
              Agregar feriado
            </Boton>
          </div>
          {cal.feriados.length ? (
            <ul className="flex flex-wrap gap-2">
              {cal.feriados.map((f) => {
                const texto = f.split('-').reverse().join('/');
                return (
                  <li key={f} className="flex items-center gap-1 rounded-full bg-superficie-2 py-1 pr-1 pl-3 text-sm">
                    {texto}
                    <button type="button" className="rounded-full p-1" aria-label={`Quitar feriado ${texto}`} onClick={() => calendario({ feriados: cal.feriados.filter((x) => x !== f) })}>
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-suave">No hay feriados cargados.</p>
          )}
        </section>
        <section className="tarjeta flex flex-col gap-3 p-4">
          <h2>Reglas</h2>
          <Campo etiqueta="Cierre automático de pedidos resueltos (horas)" ayuda="Se cuentan solo días hábiles.">
            {(p) => <input {...p} type="number" min={1} max={720} className="entrada max-w-40" value={c.horasAutocierre || ''} onChange={(e) => setC({ ...c, horasAutocierre: Number(e.target.value) })} />}
          </Campo>
          <Campo etiqueta="Tamaño máximo de adjuntos (MB)">
            {(p) => <input {...p} type="number" min={1} max={50} className="entrada max-w-40" value={c.adjuntoMaxMb || ''} onChange={(e) => setC({ ...c, adjuntoMaxMb: Number(e.target.value) })} />}
          </Campo>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5 accent-primario" checked={c.solicitanteVeArea} onChange={(e) => setC({ ...c, solicitanteVeArea: e.target.checked })} />
            Los solicitantes pueden ver los pedidos de su área
          </label>
        </section>
        {error && (
          <p role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
        <Boton type="submit" className="self-end" ocupado={guardar.isPending}>
          Guardar configuración
        </Boton>
      </form>
    </div>
  );
}
