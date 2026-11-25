import { memo, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Link } from '@tanstack/react-router';
import { EllipsisVertical, GripVertical } from 'lucide-react';
import { COLUMNAS_KANBAN, ETIQUETA_ESTADO, puedeTransicionar, type Calendario, type Estado, type Rol } from '@eco/shared/dominio';
import type { Persona, TicketResumen } from '@eco/shared/schemas';
import { BarraSla } from '../../componentes/BarraSla';
import { IconoCategoria } from '../../componentes/IconoCategoria';
import { Avatar, Contador, InsigniaPrioridad } from '../../componentes/insignias';
import { ItemMenu, Menu, SeparadorMenu, TituloMenu } from '../../componentes/ui/flotantes';
import { cn } from '../../lib/cn';

export interface AccionesTarjeta {
  mover: (id: string, estado: Estado) => void;
  desplazar: (id: string, sentido: -1 | 1) => void;
  asignar: (id: string, tecnico: Persona | null) => void;
}

export interface DatosTarjeta {
  ticket: TicketResumen;
  ahora: Date;
  calendario: Calendario;
  noLeidos: number;
}

interface PropsContenido extends DatosTarjeta {
  menu?: { acciones: AccionesTarjeta; tecnicos: Persona[]; rol: Rol };
  /** Reserva el lugar del asa, que dibuja el contenedor para no invalidar la memorización. */
  conAsa?: boolean;
}

/** El menú (incluso su contenido en un portal) no debe iniciar arrastres. */
const sinArrastre = {
  onMouseDown: (e: MouseEvent) => e.stopPropagation(),
  onTouchStart: (e: TouchEvent) => e.stopPropagation(),
};

function MenuTarjeta({ ticket: t, acciones, tecnicos, rol }: { ticket: TicketResumen; acciones: AccionesTarjeta; tecnicos: Persona[]; rol: Rol }) {
  const destinos = COLUMNAS_KANBAN.filter((e) =>
    puedeTransicionar(t.estado, e, { rol, esSolicitante: false, tieneAsignado: !!t.asignado }),
  );
  return (
    <span {...sinArrastre} className="flex">
    <Menu
      disparador={
        <button type="button" className="rounded-sm p-1 hover:bg-superficie-2" aria-label={`Acciones de ${t.codigo}`}>
          <EllipsisVertical aria-hidden className="size-4" />
        </button>
      }
    >
      {destinos.length > 0 && <TituloMenu>Mover a</TituloMenu>}
      {destinos.map((e) => (
        <ItemMenu key={e} alElegir={() => acciones.mover(t.id, e)}>
          Mover a {ETIQUETA_ESTADO[e]}
        </ItemMenu>
      ))}
      <ItemMenu alElegir={() => acciones.desplazar(t.id, -1)}>Subir en la columna</ItemMenu>
      <ItemMenu alElegir={() => acciones.desplazar(t.id, 1)}>Bajar en la columna</ItemMenu>
      <SeparadorMenu />
      <TituloMenu>Asignar a</TituloMenu>
      {tecnicos.map((p) => (
        <ItemMenu key={p.id} disabled={t.asignado?.id === p.id} alElegir={() => acciones.asignar(t.id, p)}>
          {p.nombre}
        </ItemMenu>
      ))}
      <ItemMenu disabled={!t.asignado} alElegir={() => acciones.asignar(t.id, null)}>
        Sin asignar
      </ItemMenu>
    </Menu>
    </span>
  );
}

/** Contenido memorizado: durante un arrastre solo se actualiza el contenedor. */
export const ContenidoTarjeta = memo(function ContenidoTarjeta({ ticket: t, ahora, calendario, noLeidos, menu, conAsa }: PropsContenido) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className={cn('text-xs font-bold whitespace-nowrap text-suave', conAsa && 'pl-4')}>{t.codigo}</span>
        <Contador n={noLeidos} etiqueta="mensajes sin leer" />
        <span className="ml-auto flex items-center gap-1">
          <InsigniaPrioridad prioridad={t.prioridad} />
          {menu && <MenuTarjeta ticket={t} {...menu} />}
        </span>
      </div>
      <Link
        to="/tickets/$id"
        params={{ id: t.codigo }}
        draggable={false}
        className="line-clamp-2 text-sm leading-snug font-semibold text-texto hover:underline"
      >
        {t.titulo}
      </Link>
      <div className="flex items-center gap-2 text-xs text-suave">
        <IconoCategoria nombre={t.categoriaIcono} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {t.categoriaNombre} · {t.areaNombre ?? 'Sin área'}
        </span>
        <Avatar nombre={t.asignado?.nombre ?? null} className="size-6 text-[0.6rem]" />
      </div>
      <BarraSla ticket={t} ahora={ahora} calendario={calendario} />
    </div>
  );
});

export const TarjetaArrastrable = memo(function TarjetaArrastrable({
  columna,
  valida,
  ...datos
}: DatosTarjeta & {
  columna: Estado;
  valida: boolean;
  menu: { acciones: AccionesTarjeta; tecnicos: Persona[]; rol: Rol };
}) {
  const t = datos.ticket;
  const destino = { tipo: 'tarjeta' as const, estado: columna, codigo: t.codigo };
  const arrastre = useDraggable({ id: t.id, data: destino });
  const soltar = useDroppable({ id: t.id, data: destino, disabled: !valida || arrastre.isDragging });
  const { onKeyDown, ...puntero } = arrastre.listeners ?? {};
  return (
    <div
      ref={(n) => {
        arrastre.setNodeRef(n);
        soltar.setNodeRef(n);
      }}
      {...puntero}
      data-testid={`tarjeta-${t.codigo}`}
      className={cn(
        'tarjeta relative touch-manipulation p-2.5 select-none',
        arrastre.isDragging ? 'opacity-40' : 'cursor-grab',
      )}
    >
      {soltar.isOver && <span aria-hidden className="absolute -top-1.5 right-0 left-0 h-1 rounded-full bg-primario" />}
      <button
        type="button"
        ref={arrastre.setActivatorNodeRef}
        {...arrastre.attributes}
        onKeyDown={onKeyDown as ((e: KeyboardEvent) => void) | undefined}
        className="absolute top-3.5 left-1.5 rounded-sm text-suave"
        aria-label={`Mover ${t.codigo}`}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      <ContenidoTarjeta {...datos} conAsa />
    </div>
  );
});
