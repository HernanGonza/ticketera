import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Download, Image as IconoImagen, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatearDuracion, formatearFecha } from '@eco/shared/dominio';
import { SALAS } from '@eco/shared/realtime';
import type { Estadisticas } from '@eco/shared/schemas';
import { Boton, Encabezado, ErrorVista, Esqueletos } from '../../componentes/ui/basicos';
import { ItemMenu, Menu } from '../../componentes/ui/flotantes';
import { qEstadisticas } from '../../lib/consultas';
import { cn } from '../../lib/cn';
import { descargarCsv } from '../../lib/csv';
import { useCatalogo, useSala } from '../../lib/hooks';
import { conjuntos, filasCsv, type Conjunto } from './datos';

const Grafico = lazy(() => import('./Grafico'));
const ruta = getRouteApi('/app/tablero');

async function png(nombre: string, lista: Conjunto[]) {
  const [{ instancias }, { exportarPng }] = await Promise.all([import('./Grafico'), import('./exportar')]);
  const graficos = lista.flatMap((c) => {
    const grafico = instancias.get(c.id);
    return grafico ? [{ titulo: c.titulo, grafico }] : [];
  });
  if (!graficos.length) return void toast.info('No hay gráficos visibles para exportar. Vuelva a la vista de gráfico.');
  await exportarPng(nombre, graficos);
}

export function Tablero() {
  const filtro = ruta.useSearch();
  const navegar = ruta.useNavigate();
  const catalogo = useCatalogo();
  const consulta = useQuery({ ...qEstadisticas(filtro), placeholderData: keepPreviousData });
  useSala(SALAS.tablero);
  const datos = consulta.data;
  const lista = useMemo(() => (datos ? conjuntos(datos) : []), [datos]);
  const cambiar = (c: Partial<typeof filtro>) => void navegar({ search: (s) => ({ ...s, ...c }), replace: true });

  const fecha = (etiqueta: string, clave: 'desde' | 'hasta') => (
    <label className="flex items-center gap-1.5 text-sm font-semibold">
      {etiqueta}
      <input
        type="date"
        className="entrada !w-auto"
        value={filtro[clave] ?? datos?.rango[clave] ?? ''}
        min={clave === 'hasta' ? filtro.desde : undefined}
        max={clave === 'desde' ? filtro.hasta : undefined}
        onChange={(e) => cambiar({ [clave]: e.target.value || undefined })}
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <Encabezado
        titulo="Estadísticas"
        acciones={
          <>
            <Boton
              variante="secundario"
              tamano="sm"
              disabled={!datos}
              data-testid="exportar-tablero-csv"
              onClick={() => datos && descargarCsv(`estadisticas-${datos.rango.desde}-${datos.rango.hasta}.csv`, [...filasKpi(datos), ...filasCsv(lista)])}
            >
              <Download aria-hidden className="size-4" /> CSV completo
            </Boton>
            <Boton variante="secundario" tamano="sm" disabled={!datos} onClick={() => void png('estadisticas.png', lista)}>
              <IconoImagen aria-hidden className="size-4" /> PNG completo
            </Boton>
          </>
        }
      >
        {datos
          ? `Período ${formatearFecha(`${datos.rango.desde}T12:00:00-03:00`)} al ${formatearFecha(`${datos.rango.hasta}T12:00:00-03:00`)} · se actualiza en vivo`
          : 'Se actualiza en vivo'}
      </Encabezado>
      <div role="search" aria-label="Filtros" className="mb-4 flex flex-wrap items-center gap-3">
        {fecha('Desde', 'desde')}
        {fecha('Hasta', 'hasta')}
        <select aria-label="Área" className="entrada !w-auto max-w-56" value={filtro.areaId ?? ''} onChange={(e) => cambiar({ areaId: Number(e.target.value) || undefined })}>
          <option value="">Todas las áreas</option>
          {catalogo?.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
        <select aria-label="Categoría" className="entrada !w-auto max-w-56" value={filtro.categoriaId ?? ''} onChange={(e) => cambiar({ categoriaId: Number(e.target.value) || undefined })}>
          <option value="">Todas las categorías</option>
          {catalogo?.categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {Object.values(filtro).some((v) => v !== undefined) && (
          <Boton variante="fantasma" tamano="sm" onClick={() => void navegar({ search: {}, replace: true })}>
            Limpiar filtros
          </Boton>
        )}
      </div>
      {consulta.isPending ? (
        <Esqueletos filas={4} alto="h-40" />
      ) : !datos ? (
        <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />
      ) : (
        <div className={cn(consulta.isPlaceholderData && 'opacity-60')}>
          <Indicadores e={datos} />
          <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
            {lista.map((c) => (
              <TarjetaGrafico key={c.id} conjunto={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const duracion = (m: number | null) => (m === null ? 'Sin datos' : formatearDuracion(m));
const porcentaje = (v: number | null) => (v === null ? 'Sin datos' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`);

function filasKpi(e: Estadisticas) {
  const k = e.kpis;
  const t = e.tiempos;
  return [
    ['Indicadores'],
    ['Abiertos', k.abiertos],
    ['Sin asignar', k.sinAsignar],
    ['Vencidos', k.vencidos],
    ['Por vencer', k.porVencer],
    ['Creados hoy', k.creadosHoy],
    ['Resueltos hoy', k.resueltosHoy],
    ['Mediana de primera respuesta (min)', t.medianaRespuestaMin],
    ['Mediana de resolución (min)', t.medianaResolucionMin],
    ['Cumplimiento de plazos (%)', t.cumplimientoSlaPct],
    ['Tasa de reabiertos (%)', t.tasaReabiertosPct],
    ['Calificación promedio', t.calificacionPromedio],
    [],
  ];
}

function Indicadores({ e }: { e: Estadisticas }) {
  const { kpis: k, tiempos: t } = e;
  const dato = (titulo: string, valor: ReactNode, extra?: { alerta?: boolean; enlace?: { sinAsignar?: boolean; vencidos?: boolean } }) => {
    const cuerpo = (
      <>
        <span className="block text-xs font-semibold text-suave">{titulo}</span>
        <span className={cn('block text-2xl font-bold', extra?.alerta && 'text-peligro')}>{valor}</span>
      </>
    );
    return (
      <li key={titulo} className="tarjeta p-3">
        {extra?.enlace ? (
          <Link to="/kanban" search={extra.enlace} className="block text-texto hover:underline">
            {cuerpo}
          </Link>
        ) : (
          cuerpo
        )}
      </li>
    );
  };
  return (
    <>
      <h2 className="sr-only">Indicadores actuales</h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="kpis">
        {dato('Abiertos', k.abiertos)}
        {dato('Sin asignar', k.sinAsignar, { enlace: { sinAsignar: true } })}
        {dato('Vencidos', k.vencidos, { alerta: k.vencidos > 0, enlace: { vencidos: true } })}
        {dato('Por vencer', k.porVencer)}
        {dato('Creados hoy', k.creadosHoy)}
        {dato('Resueltos hoy', k.resueltosHoy)}
      </ul>
      <h2 className="mt-4 mb-2">Desempeño del período</h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {dato('Primera respuesta (mediana)', duracion(t.medianaRespuestaMin))}
        {dato('Resolución (mediana)', duracion(t.medianaResolucionMin))}
        {dato('Cumplimiento de plazos', porcentaje(t.cumplimientoSlaPct))}
        {dato('Tasa de reabiertos', porcentaje(t.tasaReabiertosPct))}
        {dato('Calificación promedio', t.calificacionPromedio === null ? 'Sin datos' : `${t.calificacionPromedio.toFixed(1).replace('.', ',')} de 5`)}
      </ul>
    </>
  );
}

function TarjetaGrafico({ conjunto: c }: { conjunto: Conjunto }) {
  const [tabla, setTabla] = useState(false);
  const vacio = !c.filas.length;
  return (
    <section className={cn('tarjeta min-w-0 p-4', (c.tipo === 'calor' || c.id === 'semanal') && 'xl:col-span-2')} aria-label={c.titulo} data-testid={`grafico-${c.id}`}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2>{c.titulo}</h2>
          <p className="text-xs text-suave">{c.descripcion}</p>
        </div>
        <div className="flex gap-1">
          <Boton variante="fantasma" tamano="sm" aria-pressed={tabla} onClick={() => setTabla(!tabla)}>
            <Table2 aria-hidden className="size-4" /> {tabla ? 'Gráfico' : 'Tabla'}
          </Boton>
          <Menu
            disparador={
              <Boton variante="fantasma" tamano="sm" aria-label={`Exportar: ${c.titulo}`}>
                <Download aria-hidden className="size-4" />
              </Boton>
            }
          >
            <ItemMenu alElegir={() => descargarCsv(`${c.id}.csv`, [c.columnas, ...c.filas])}>Exportar CSV</ItemMenu>
            <ItemMenu disabled={tabla || vacio} alElegir={() => void png(`${c.id}.png`, [c])}>
              Exportar PNG
            </ItemMenu>
          </Menu>
        </div>
      </div>
      {vacio ? (
        <p className="py-10 text-center text-sm text-suave">No hay datos en el período.</p>
      ) : (
        <>
          {!tabla && (
            <div className="overflow-x-auto">
              <div className={cn(c.tipo === 'calor' && 'min-w-[40rem]')}>
                <Suspense fallback={<div className="esqueleto h-64" />}>
                  <Grafico conjunto={c} />
                </Suspense>
              </div>
            </div>
          )}
          {/* La tabla siempre está disponible para lectores de pantalla. */}
          <div className={cn(tabla ? 'max-h-96 overflow-auto' : 'sr-only')} tabIndex={tabla ? 0 : undefined}>
            <table className="w-full text-sm">
              <caption className="sr-only">{c.titulo}</caption>
              <thead>
                <tr className="border-b border-borde text-left">
                  {c.columnas.map((x) => (
                    <th key={x} scope="col" className="p-1.5 font-semibold whitespace-nowrap">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.filas.map((f, i) => (
                  <tr key={i} className="border-b border-borde last:border-0">
                    {f.map((v, j) =>
                      j === 0 ? (
                        <th key={j} scope="row" className="p-1.5 text-left font-normal">
                          {v}
                        </th>
                      ) : (
                        <td key={j} className="p-1.5 tabular-nums">
                          {typeof v === 'number' ? v.toLocaleString('es-AR') : (v ?? '—')}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
