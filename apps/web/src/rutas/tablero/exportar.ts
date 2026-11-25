import type { ECharts } from 'echarts/core';
import { descargar } from '../../lib/csv';

const color = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const cargar = (src: string) =>
  new Promise<HTMLImageElement>((ok, fallo) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fallo;
    i.src = src;
  });

/** Compone uno o varios gráficos, con su título, en un único PNG. */
export async function exportarPng(nombre: string, graficos: { titulo: string; grafico: ECharts }[]) {
  if (!graficos.length) return;
  const escala = 2;
  const imagenes = await Promise.all(
    graficos.map(async (g) => ({
      titulo: g.titulo,
      img: await cargar(g.grafico.getDataURL({ type: 'png', pixelRatio: escala, backgroundColor: color('--superficie') })),
    })),
  );
  const margen = 20 * escala;
  const titulo = 36 * escala;
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(...imagenes.map((i) => i.img.width)) + margen * 2;
  lienzo.height = imagenes.reduce((a, i) => a + i.img.height + titulo + margen, margen);
  const c = lienzo.getContext('2d');
  if (!c) return;
  c.fillStyle = color('--superficie');
  c.fillRect(0, 0, lienzo.width, lienzo.height);
  let y = margen;
  for (const i of imagenes) {
    c.fillStyle = color('--texto');
    c.font = `700 ${16 * escala}px ${getComputedStyle(document.body).fontFamily}`;
    c.fillText(i.titulo, margen, y + 18 * escala);
    c.drawImage(i.img, margen, y + titulo);
    y += i.img.height + titulo + margen;
  }
  descargar(nombre, lienzo.toDataURL('image/png'));
}
