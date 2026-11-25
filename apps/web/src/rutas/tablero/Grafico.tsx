/** ECharts modular (canvas). Los colores se leen de las variables CSS en cada tema. */
import { useEffect, useRef } from 'react';
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { init, use as registrar, type ECharts, type EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useAlmacen } from '../../lib/almacen';
import { preferencias } from '../../lib/preferencias';
import { DIAS, type Conjunto } from './datos';

registrar([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, AriaComponent, CanvasRenderer]);

export const instancias = new Map<string, ECharts>();

const numero = (v: unknown, unidad = '') => (typeof v === 'number' ? `${v.toLocaleString('es-AR')}${unidad}` : '—');

const color = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();

export function opcion(c: Conjunto): EChartsCoreOption {
  const texto = color('--texto');
  const suave = color('--texto-suave');
  const rejilla = color('--grafico-rejilla');
  const eje = color('--grafico-eje');
  const superficie = color('--superficie');
  const series = [color('--grafico-1'), color('--grafico-2'), color('--grafico-3')];
  const fuente = { fontFamily: getComputedStyle(document.body).fontFamily };
  const base: EChartsCoreOption = {
    color: series,
    textStyle: { ...fuente, color: texto },
    animationDuration: 300,
    aria: { enabled: true, label: { description: `${c.titulo}. ${c.descripcion}` } },
    tooltip: {
      renderMode: 'richText',
      backgroundColor: superficie,
      borderColor: eje,
      textStyle: { ...fuente, color: texto },
      confine: true,
    },
  };
  const lineaEje = { lineStyle: { color: eje } };
  const etiqueta = { color: suave, ...fuente };
  const valores = {
    type: 'value',
    axisLabel: etiqueta,
    splitLine: { lineStyle: { color: rejilla } },
    minInterval: c.unidad ? undefined : 1,
  };
  const leyenda = c.series.length > 1 ? { top: 0, left: 0, textStyle: { color: texto, ...fuente }, itemWidth: 14, itemHeight: 8 } : undefined;
  const grilla = { left: 4, right: 40, top: leyenda ? 36 : 12, bottom: 4, containLabel: true };

  if (c.tipo === 'calor') {
    const datos = c.filas.flatMap((f, d) => f.slice(1).map((v, h) => [h, d, Number(v)]));
    return {
      ...base,
      tooltip: {
        ...(base.tooltip as object),
        formatter: (p: { value: number[] }) => `${DIAS[p.value[1] ?? 0]} ${p.value[0]} h: ${p.value[2]} pedidos`,
      },
      grid: { left: 4, right: 8, top: 8, bottom: 56, containLabel: true },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => String(h)), axisLabel: etiqueta, axisLine: lineaEje },
      yAxis: { type: 'category', data: DIAS.map((d) => d.slice(0, 3)), inverse: true, axisLabel: etiqueta, axisLine: lineaEje },
      visualMap: {
        min: 0,
        max: Math.max(1, ...datos.map((d) => d[2] ?? 0)),
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        calculable: false,
        textStyle: etiqueta,
        inRange: { color: [0, 1, 2, 3, 4].map((i) => color(`--grafico-seq-${i}`)) },
      },
      series: [{ type: 'heatmap', data: datos, itemStyle: { borderColor: superficie, borderWidth: 2, borderRadius: 3 } }],
    };
  }

  const categorias = c.filas.map((f) => String(f[0]));
  const horizontal = c.tipo === 'barrasH';
  const ejeCategorias = {
    type: 'category',
    data: categorias,
    inverse: horizontal,
    axisLine: lineaEje,
    axisTick: { show: false },
    axisLabel: horizontal ? { ...etiqueta, width: 130, overflow: 'truncate' } : etiqueta,
    boundaryGap: horizontal,
  };
  return {
    ...base,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: horizontal ? 'shadow' : 'line', lineStyle: { color: eje } },
      valueFormatter: (v: unknown) => numero(v, c.unidad),
    },
    legend: leyenda,
    grid: grilla,
    xAxis: horizontal ? valores : ejeCategorias,
    yAxis: horizontal ? ejeCategorias : valores,
    series: c.series.map((i) => ({
      name: c.columnas[i],
      data: c.filas.map((f) => f[i] ?? null),
      ...(horizontal
        ? {
            type: 'bar',
            barMaxWidth: 18,
            barGap: '15%',
            itemStyle: { borderRadius: [0, 4, 4, 0] },
            label: {
              show: c.series.length === 1,
              position: 'right',
              color: texto,
              ...fuente,
              formatter: (x: { value: unknown }) => numero(x.value, c.unidad),
            },
          }
        : {
            type: 'line',
            lineStyle: { width: 2 },
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: { borderColor: superficie, borderWidth: 2 },
            areaStyle: c.tipo === 'area' ? { opacity: 0.12 } : undefined,
          }),
    })),
  };
}

export default function Grafico({ conjunto }: { conjunto: Conjunto }) {
  const caja = useRef<HTMLDivElement>(null);
  const grafico = useRef<ECharts | null>(null);
  const tema = useAlmacen(preferencias, (p) => p.tema);

  useEffect(() => {
    const nodo = caja.current!;
    const g = init(nodo, undefined, { renderer: 'canvas' });
    grafico.current = g;
    instancias.set(conjunto.id, g);
    const observador = new ResizeObserver(() => g.resize());
    observador.observe(nodo);
    return () => {
      observador.disconnect();
      instancias.delete(conjunto.id);
      g.dispose();
      grafico.current = null;
    };
  }, [conjunto.id]);

  useEffect(() => {
    grafico.current?.setOption(opcion(conjunto), { replaceMerge: ['series'] });
  }, [conjunto, tema]);

  const alto =
    conjunto.tipo === 'barrasH' ? Math.max(220, conjunto.filas.length * (conjunto.series.length > 1 ? 52 : 30) + 50) : 280;
  return <div ref={caja} style={{ height: alto }} className="w-full" />;
}
