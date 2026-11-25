/** Detección de colisiones, teclado y anuncios en español para el tablero. */
import {
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { ETIQUETA_ESTADO, type Estado } from '@eco/shared/dominio';

export type DatosDestino =
  | { tipo: 'columna'; estado: Estado }
  | { tipo: 'tarjeta'; estado: Estado; codigo: string }
  | { tipo: 'avatar'; tecnico: { id: string; nombre: string } | null };

const PESO = { avatar: 0, tarjeta: 1, columna: 2 } as const;

export const colisiones: CollisionDetection = (args) => {
  const datos = (id: string | number) =>
    args.droppableContainers.find((c) => c.id === id)?.data.current as DatosDestino | undefined;
  if (args.pointerCoordinates) {
    const dentro = pointerWithin(args);
    const lista = dentro.length ? dentro : rectIntersection(args);
    return [...lista].sort((a, b) => PESO[datos(a.id)?.tipo ?? 'columna'] - PESO[datos(b.id)?.tipo ?? 'columna']);
  }
  // Teclado: la columna que contiene el centro y, dentro de ella, la tarjeta a la misma altura.
  const r = args.collisionRect;
  const x = r.left + r.width / 2;
  const conRect = args.droppableContainers.flatMap((c) => {
    const rect = args.droppableRects.get(c.id);
    const d = c.data.current as DatosDestino | undefined;
    return rect && d ? [{ c, rect, d }] : [];
  });
  const columna = conRect.find((o) => o.d.tipo === 'columna' && x >= o.rect.left && x <= o.rect.right);
  if (!columna || columna.d.tipo !== 'columna') return [];
  const estado = columna.d.estado;
  const tarjetas = conRect
    .filter((o) => o.d.tipo === 'tarjeta' && o.d.estado === estado)
    .sort((a, b) => Math.abs(a.rect.top - r.top) - Math.abs(b.rect.top - r.top));
  const cercana = tarjetas[0];
  const fin = Math.max(...tarjetas.map((t) => t.rect.bottom));
  const elegido = cercana && r.top < fin - 4 ? cercana : columna;
  return [{ id: elegido.c.id }];
};

export const coordenadasTeclado: KeyboardCoordinateGetter = (evento, { context }) => {
  const { collisionRect: r, droppableContainers, droppableRects } = context;
  if (!r || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(evento.code)) return undefined;
  evento.preventDefault();
  const destinos = droppableContainers.getEnabled().flatMap((c) => {
    const rect = droppableRects.get(c.id);
    const d = c.data.current as DatosDestino | undefined;
    return rect && d ? [{ rect, d }] : [];
  });
  const x = r.left + r.width / 2;
  if (evento.code === 'ArrowLeft' || evento.code === 'ArrowRight') {
    const derecha = evento.code === 'ArrowRight';
    const columnas = destinos
      .filter((o) => o.d.tipo === 'columna' && (derecha ? o.rect.left > x : o.rect.right < x))
      .sort((a, b) => (derecha ? a.rect.left - b.rect.left : b.rect.left - a.rect.left));
    const c = columnas[0];
    return c ? { x: c.rect.left + 8, y: c.rect.top + 52 } : undefined;
  }
  const abajo = evento.code === 'ArrowDown';
  const tarjetas = destinos
    .filter((o) => o.d.tipo === 'tarjeta' && x >= o.rect.left && x <= o.rect.right)
    .filter((o) => (abajo ? o.rect.top > r.top + 4 : o.rect.top < r.top - 4))
    .sort((a, b) => (abajo ? a.rect.top - b.rect.top : b.rect.top - a.rect.top));
  const t = tarjetas[0];
  if (t) return { x: t.rect.left, y: t.rect.top };
  return abajo ? { x: r.left, y: r.top + r.height } : undefined;
};

export const instrucciones = {
  draggable:
    'Para mover el ticket presione la barra espaciadora. Use las flechas izquierda y derecha para cambiar de columna y arriba y abajo para cambiar la posición. Presione espacio o Enter para soltar, o Escape para cancelar. También puede usar el menú de acciones del ticket.',
};

export function anuncios(codigoDe: (id: string) => string): Announcements {
  const destino = (d: DatosDestino | undefined) => {
    if (!d) return 'fuera de las columnas';
    if (d.tipo === 'columna') return `la columna ${ETIQUETA_ESTADO[d.estado]}`;
    if (d.tipo === 'tarjeta') return `el ticket ${d.codigo} de la columna ${ETIQUETA_ESTADO[d.estado]}`;
    return d.tecnico ? `el técnico ${d.tecnico.nombre}` : 'sin asignar';
  };
  const datos = (d: unknown) => d as DatosDestino | undefined;
  return {
    onDragStart: ({ active }) => `Tomó el ticket ${codigoDe(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      `El ticket ${codigoDe(String(active.id))} está sobre ${destino(datos(over?.data.current))}.`,
    onDragEnd: ({ active, over }) =>
      `Soltó el ticket ${codigoDe(String(active.id))} en ${destino(datos(over?.data.current))}.`,
    onDragCancel: ({ active }) => `Se canceló el movimiento del ticket ${codigoDe(String(active.id))}.`,
  };
}
