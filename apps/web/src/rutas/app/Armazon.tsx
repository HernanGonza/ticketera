/** Estructura de la aplicación autenticada: cabecera, menú lateral y conexión en vivo. */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import {
  BarChart3,
  Building2,
  Clock,
  Inbox,
  KanbanSquare,
  Layers,
  ListChecks,
  Menu as IconoMenu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Shapes,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { SALAS } from '@eco/shared/realtime';
import { NOMBRE_SISTEMA } from '@eco/shared/marca';
import { esAdmin, esStaff, type UsuarioSesion } from '@eco/shared/dominio';
import { Firma, NombreSistema } from '../../componentes/Firma';
import { Boton, estilosBoton } from '../../componentes/ui/basicos';
import { Cajon } from '../../componentes/ui/flotantes';
import { useAlmacen } from '../../lib/almacen';
import { notificarNavegador, sonar } from '../../lib/avisos';
import { cn } from '../../lib/cn';
import { useCatalogo, useSala, useUsuario } from '../../lib/hooks';
import { cambiarPreferencias, preferencias } from '../../lib/preferencias';
import { Campana, Conexion, MenuUsuario, NoLeidosGlobal, SelectorTema } from './Cabecera';

interface Item {
  to: '/mis-pedidos' | '/nuevo' | '/kanban' | '/lista' | '/tablero' | '/admin/categorias' | '/admin/usuarios' | '/admin/areas' | '/admin/configuracion' | '/admin/colas';
  texto: string;
  icono: LucideIcon;
}

function menuDe(u: UsuarioSesion): { titulo?: string; items: Item[] }[] {
  const pedidos: Item[] = [
    { to: '/nuevo', texto: 'Nuevo pedido', icono: Plus },
    { to: '/mis-pedidos', texto: 'Mis pedidos', icono: Inbox },
  ];
  if (!esStaff(u)) return [{ items: pedidos }];
  const grupos: { titulo?: string; items: Item[] }[] = [
    {
      titulo: 'Gestión',
      items: [
        { to: '/kanban', texto: 'Tablero Kanban', icono: KanbanSquare },
        { to: '/lista', texto: 'Lista', icono: ListChecks },
        { to: '/tablero', texto: 'Estadísticas', icono: BarChart3 },
      ],
    },
    { titulo: 'Mis pedidos', items: pedidos },
  ];
  if (esAdmin(u))
    grupos.push({
      titulo: 'Administración',
      items: [
        { to: '/admin/categorias', texto: 'Categorías', icono: Shapes },
        { to: '/admin/usuarios', texto: 'Usuarios', icono: Users },
        { to: '/admin/areas', texto: 'Áreas', icono: Building2 },
        { to: '/admin/configuracion', texto: 'Configuración', icono: Clock },
        { to: '/admin/colas', texto: 'Colas', icono: Layers },
      ],
    });
  return grupos;
}

function Navegacion({ usuario, colapsado, alElegir }: { usuario: UsuarioSesion; colapsado?: boolean; alElegir?: () => void }) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-4">
      {menuDe(usuario).map((g, i) => (
        <div key={i}>
          {g.titulo && !colapsado && <p className="mb-1 px-3 text-xs font-semibold text-suave">{g.titulo}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ to, texto, icono: I }) => (
              <li key={to}>
                <Link
                  to={to}
                  onClick={alElegir}
                  title={colapsado ? texto : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-texto hover:bg-superficie-2',
                    colapsado && 'justify-center px-0',
                  )}
                  activeProps={{ className: 'bg-primario-suave !text-primario-sobre-suave font-bold' }}
                >
                  <I aria-hidden className="size-5 shrink-0" />
                  <span className={cn(colapsado && 'sr-only')}>{texto}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Conecta el socket (en un fragmento aparte) y avisa a los técnicos. */
function useTiempoReal(usuario: UsuarioSesion) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const staff = esStaff(usuario);
  useEffect(() => {
    let cancelado = false;
    let desconectar: (() => void) | undefined;
    void import('../../lib/socket').then(({ conectar }) => {
      if (cancelado) return;
      desconectar = conectar(qc, {
        usuarioId: usuario.id,
        alertar: staff
          ? (t, motivo) => {
              const titulo = motivo === 'critico' ? `Ticket crítico ${t.codigo}` : `Nuevo ticket ${t.codigo}`;
              toast(titulo, {
                id: `alerta-${t.id}`,
                description: t.titulo,
                action: { label: 'Ver', onClick: () => void navegar({ to: '/tickets/$id', params: { id: t.codigo } }) },
              });
              const p = preferencias.leer();
              if (p.sonido) sonar(motivo === 'critico');
              if (p.notificaciones) notificarNavegador(titulo, t.titulo, `/tickets/${t.codigo}`);
            }
          : undefined,
      });
    });
    return () => {
      cancelado = true;
      desconectar?.();
    };
  }, [qc, navegar, usuario.id, staff]);
}

export function Armazon() {
  const usuario = useUsuario();
  const staff = esStaff(usuario);
  useCatalogo();
  useTiempoReal(usuario);
  useSala(staff ? SALAS.tecnicos : undefined);
  const colapsado = useAlmacen(preferencias, (p) => p.menuColapsado);
  const [cajon, setCajon] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pathname.startsWith('/tickets/')) document.title = NOMBRE_SISTEMA;
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primario px-4 py-2 text-primario-texto focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-borde bg-superficie px-3 md:gap-4 md:px-4">
        <Boton variante="fantasma" tamano="icono" className="md:hidden" aria-label="Abrir menú" onClick={() => setCajon(true)}>
          <IconoMenu aria-hidden className="size-5" />
        </Boton>
        <Firma compacta className="max-sm:hidden" />
        <span aria-hidden className="h-8 w-px bg-borde-fuerte max-sm:hidden" />
        <Link to="/" className="rounded-md text-xl">
          <NombreSistema />
          <span className="sr-only">: ir al inicio</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <Conexion />
          <NoLeidosGlobal staff={staff} />
          <Campana />
          <SelectorTema />
          <MenuUsuario usuario={usuario} />
        </div>
      </header>
      <Cajon abierto={cajon} cerrar={() => setCajon(false)} titulo={NOMBRE_SISTEMA}>
        <Firma />
        <Navegacion usuario={usuario} alElegir={() => setCajon(false)} />
      </Cajon>
      <div className="flex flex-1">
        <aside
          className={cn(
            'sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 flex-col justify-between gap-4 overflow-y-auto border-r border-borde bg-superficie p-2 md:flex',
            colapsado ? 'w-16' : 'w-56',
          )}
        >
          <Navegacion usuario={usuario} colapsado={colapsado} />
          <button
            type="button"
            className={cn(estilosBoton({ variante: 'fantasma', tamano: 'sm' }), colapsado ? 'self-center' : 'self-start')}
            onClick={() => cambiarPreferencias({ menuColapsado: !colapsado })}
            aria-expanded={!colapsado}
          >
            {colapsado ? <PanelLeftOpen aria-hidden className="size-5" /> : <PanelLeftClose aria-hidden className="size-5" />}
            <span className={cn(colapsado && 'sr-only')}>{colapsado ? 'Expandir menú' : 'Contraer menú'}</span>
          </button>
        </aside>
        <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 p-3 outline-none md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
