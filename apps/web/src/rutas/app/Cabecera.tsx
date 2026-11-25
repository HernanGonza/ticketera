import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bell, LogOut, MessageSquare, Moon, Settings, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { esStaff, ETIQUETA_ROL, formatearFechaHora, iniciales } from '@eco/shared/dominio';
import type { UsuarioActual } from '@eco/shared/schemas';
import { Avatar, Contador } from '../../componentes/insignias';
import { Boton, Esqueletos } from '../../componentes/ui/basicos';
import { Dialogo, ItemMenu, Menu, Panel, SeparadorMenu } from '../../componentes/ui/flotantes';
import { useAlmacen } from '../../lib/almacen';
import { api } from '../../lib/api';
import { pedirPermisoNotificaciones, sonar } from '../../lib/avisos';
import { marcarLeidas, type DatosNotificaciones } from '../../lib/cache';
import { claves, qNoLeidos, qNotificaciones } from '../../lib/consultas';
import { cn } from '../../lib/cn';
import { cambiarPreferencias, preferencias } from '../../lib/preferencias';
import { cerrarSesion } from '../../lib/sesion';
import { conexion } from '../../lib/vivo';

export function Conexion() {
  const ok = useAlmacen(conexion);
  const texto = ok ? 'Conectado en vivo' : 'Sin conexión en vivo: reconectando';
  return (
    <span
      data-testid="conexion"
      data-estado={ok ? 'conectado' : 'desconectado'}
      role="status"
      title={texto}
      className="flex size-8 items-center justify-center"
    >
      <span aria-hidden className={cn('size-3 rounded-full', ok ? 'bg-conexion-si' : 'bg-conexion-no')} />
      <span className="sr-only">{texto}</span>
    </span>
  );
}

/** Solo staff: los empleados ven el contador sobre "Mis pedidos". */
export function NoLeidosGlobal() {
  const total = useQuery(qNoLeidos).data?.total ?? 0;
  if (!total) return null;
  return (
    <Link
      to="/kanban"
      search={{ mios: true }}
      className="flex items-center gap-1 rounded-md p-1.5 hover:bg-superficie-2"
      title="Mensajes sin leer"
      data-testid="no-leidos-total"
    >
      <MessageSquare aria-hidden className="size-5" />
      <Contador n={total} etiqueta="mensajes sin leer" />
    </Link>
  );
}

export function Campana() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(qNotificaciones);
  const leer = useMutation({
    mutationFn: (ids?: number[]) => api('/api/notificaciones/leer', { metodo: 'POST', cuerpo: { ids } }),
    onMutate: (ids) =>
      qc.setQueryData<DatosNotificaciones>(claves.notificaciones, (d) => (d ? marcarLeidas(d, ids) : d)),
    onError: () => qc.invalidateQueries({ queryKey: claves.notificaciones }),
  });
  const sinLeer = data?.sinLeer ?? 0;
  return (
    <Panel
      titulo="Notificaciones"
      disparador={
        <Boton variante="fantasma" tamano="icono" className="relative" aria-label={`Notificaciones${sinLeer ? `: ${sinLeer} sin leer` : ''}`}>
          <Bell aria-hidden className="size-5" />
          <Contador n={sinLeer} etiqueta="sin leer" className="absolute -top-0.5 -right-0.5" />
        </Boton>
      }
    >
      {(cerrar) => (
        <div>
          <div className="flex items-center justify-between gap-2 border-b border-borde p-3">
            <h2 className="text-base">Notificaciones</h2>
            <Boton variante="fantasma" tamano="sm" disabled={!sinLeer} onClick={() => leer.mutate(undefined)}>
              Marcar todas como leídas
            </Boton>
          </div>
          {isPending ? (
            <Esqueletos filas={3} alto="h-12" className="p-3" />
          ) : !data?.items.length ? (
            <p className="p-6 text-center text-sm text-suave">No tiene notificaciones.</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id} className="border-b border-borde last:border-0">
                  <Link
                    to="/tickets/$id"
                    params={{ id: n.payload.codigo }}
                    onClick={() => {
                      if (!n.leida) leer.mutate([n.id]);
                      cerrar();
                    }}
                    className={cn('block p-3 text-sm hover:bg-superficie-2', !n.leida && 'bg-primario-suave text-primario-sobre-suave hover:bg-primario-suave')}
                  >
                    <span className="block font-semibold">
                      {!n.leida && <span className="sr-only">Sin leer: </span>}
                      {n.payload.texto}
                    </span>
                    <span className="block truncate">
                      {n.payload.codigo} · {n.payload.titulo}
                    </span>
                    <time dateTime={n.creadaAt} className="text-xs opacity-80">
                      {formatearFechaHora(n.creadaAt)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

export function SelectorTema() {
  const oscuro = useAlmacen(preferencias, (p) => p.tema) === 'oscuro';
  return (
    <Boton
      variante="fantasma"
      tamano="icono"
      aria-label={oscuro ? 'Usar tema claro' : 'Usar tema oscuro'}
      title={oscuro ? 'Usar tema claro' : 'Usar tema oscuro'}
      onClick={() => cambiarPreferencias({ tema: oscuro ? 'claro' : 'oscuro' })}
    >
      {oscuro ? <Sun aria-hidden className="size-5" /> : <Moon aria-hidden className="size-5" />}
    </Boton>
  );
}

function Preferencias({ cerrar, staff }: { cerrar: () => void; staff: boolean }) {
  const p = useAlmacen(preferencias);
  const casilla = (texto: string, valor: boolean, cambiar: (v: boolean) => void, ayuda?: string) => (
    <label className="flex items-start gap-3 py-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primario" checked={valor} onChange={(e) => cambiar(e.target.checked)} />
      <span>
        <span className="font-semibold">{texto}</span>
        {ayuda && <span className="block text-xs text-suave">{ayuda}</span>}
      </span>
    </label>
  );
  return (
    <Dialogo abierto cerrar={cerrar} titulo="Preferencias" descripcion="Se guardan en este navegador.">
      {casilla('Tema oscuro', p.tema === 'oscuro', (v) => cambiarPreferencias({ tema: v ? 'oscuro' : 'claro' }))}
      {staff && (
        <>
          {casilla(
            'Sonido de aviso',
            p.sonido,
            (v) => {
              cambiarPreferencias({ sonido: v });
              if (v) sonar();
            },
            'Suena al ingresar un ticket nuevo o crítico.',
          )}
          {casilla(
            'Notificaciones del navegador',
            p.notificaciones,
            (v) => {
              if (!v) return cambiarPreferencias({ notificaciones: false });
              void pedirPermisoNotificaciones().then((ok) => {
                cambiarPreferencias({ notificaciones: ok });
                if (!ok) toast.error('El navegador no permitió las notificaciones. Revise los permisos del sitio.');
              });
            },
            'Avisa aunque la pestaña esté en segundo plano.',
          )}
        </>
      )}
    </Dialogo>
  );
}

export function MenuUsuario({ usuario }: { usuario: UsuarioActual }) {
  const [abierto, setAbierto] = useState(false);
  const salir = useMutation({ mutationFn: cerrarSesion });
  return (
    <>
      <Menu
        disparador={
          <button type="button" className="rounded-full" aria-label={`${iniciales(usuario.nombre)}: menú de ${usuario.nombre}`} data-testid="menu-usuario">
            <Avatar nombre={usuario.nombre} className="size-9" />
          </button>
        }
      >
        <div className="max-w-64 px-2.5 py-1.5 text-sm">
          <p className="font-bold">{usuario.nombre}</p>
          <p className="truncate text-xs text-suave">{usuario.email}</p>
          <p className="text-xs text-suave">
            {ETIQUETA_ROL[usuario.rol]}
            {usuario.areaNombre ? ` · ${usuario.areaNombre}` : ''}
          </p>
        </div>
        <SeparadorMenu />
        <ItemMenu alElegir={() => setAbierto(true)}>
          <Settings aria-hidden className="size-4" /> Preferencias
        </ItemMenu>
        <ItemMenu alElegir={() => salir.mutate()}>
          <LogOut aria-hidden className="size-4" /> Cerrar sesión
        </ItemMenu>
      </Menu>
      {abierto && <Preferencias staff={esStaff(usuario)} cerrar={() => setAbierto(false)} />}
    </>
  );
}
