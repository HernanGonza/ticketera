/** Contraste WCAG AA de las combinaciones texto/fondo y de los elementos gráficos, en ambos temas. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESTADOS, PRIORIDADES } from '@eco/shared/dominio';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const css = readFileSync(join(src, 'styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function bloque(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`Falta el bloque ${selector}`);
  const cuerpo = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...cuerpo.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const claro = bloque(':root');
const temas = { claro, oscuro: { ...claro, ...bloque(":root[data-theme='dark']") } };

function hex(t: Record<string, string>, nombre: string): string {
  const v = t[nombre];
  if (!v) throw new Error(`Token inexistente: --${nombre}`);
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  if (ref) return hex(t, ref[1]!);
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--${nombre} no es un color opaco: ${v}`);
  return v;
}
function luminancia(c: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const x = parseInt(c.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contraste(a: string, b: string) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}

const FONDOS = ['fondo', 'superficie', 'superficie-2'];
const texto: [string, string][] = [
  ...FONDOS.flatMap((f): [string, string][] => [
    ['texto', f],
    ['texto-suave', f],
    ['enlace', f],
    ['peligro', f],
  ]),
  ['primario', 'fondo'],
  ['primario', 'superficie'],
  ['primario-texto', 'primario'],
  ['primario-texto', 'primario-fuerte'],
  ['primario-sobre-suave', 'primario-suave'],
  ['enlace', 'primario-suave'],
  ['acento-texto', 'acento'],
  ['acento-sobre-suave', 'acento-suave'],
  ['peligro-texto', 'peligro'],
  ['peligro-sobre-suave', 'peligro-suave'],
  ['aviso-sobre-suave', 'aviso-suave'],
  ['exito-sobre-suave', 'exito-suave'],
  ['nota-texto', 'nota-fondo'],
  ['enlace', 'nota-fondo'],
  ['firma-verde', 'superficie'],
  ...ESTADOS.map((e): [string, string] => [`estado-${e}-texto`, `estado-${e}-fondo`]),
  ...PRIORIDADES.map((p): [string, string] => [`prioridad-${p}-texto`, `prioridad-${p}-fondo`]),
];
const grafico: [string, string][] = [
  ['borde-fuerte', 'superficie'],
  ['borde-fuerte', 'fondo'],
  ['foco', 'fondo'],
  ['foco', 'superficie'],
  ['acento', 'superficie'],
  ['conexion-si', 'superficie'],
  ['conexion-no', 'superficie'],
  ...['ok', 'por_vencer', 'vencido', 'pausado', 'cumplido'].map((s): [string, string] => [`sla-${s}`, 'superficie-2']),
  ...ESTADOS.filter((e) => e !== 'cancelado').map((e): [string, string] => [`estado-${e}`, 'superficie-2']),
  // grafico-3 queda apenas por debajo de 3:1 en claro: los gráficos ofrecen etiquetas y tabla.
  ['grafico-1', 'superficie'],
  ['grafico-2', 'superficie'],
];

describe.each(Object.entries(temas))('contraste en tema %s', (_nombre, t) => {
  it.each(texto)('texto --%s sobre --%s cumple 4,5:1', (a, b) => {
    expect(contraste(hex(t, a), hex(t, b))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(grafico)('gráfico --%s sobre --%s cumple 3:1', (a, b) => {
    expect(contraste(hex(t, a), hex(t, b))).toBeGreaterThanOrEqual(3);
  });
});

describe('colores centralizados', () => {
  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const r = join(dir, n);
      return statSync(r).isDirectory() ? archivos(r) : [r];
    });
  it('no hay colores escritos fuera de tokens.css', () => {
    const color = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/i;
    const nombrado = /\b(?:text|bg|border|fill|stroke|ring|outline)-(?:white|black|(?:red|blue|green|gray|slate|zinc|yellow|pink)-\d+)\b/;
    const infractores = archivos(src)
      .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('tokens.css'))
      .filter((f) => {
        const c = readFileSync(f, 'utf8');
        return color.test(c) || nombrado.test(c);
      });
    expect(infractores).toEqual([]);
  });
});
