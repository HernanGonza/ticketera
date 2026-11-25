/** Árbol de rutas: cada pantalla es un fragmento aparte y las guardas aplican el rol. */
import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ESTADOS, PRIORIDADES, esAdmin, esStaff, type UsuarioSesion } from '@eco/shared/dominio';
import type { UsuarioActual } from '@eco/shared/schemas';
import { Cargando, ErrorVista } from './componentes/ui/basicos';
import { ErrorApiCliente } from './lib/api';
import { rutaInterna } from './lib/rutas';
import { qSesion } from './lib/sesion';
import * as b from './lib/busqueda';

const raiz = createRootRouteWithContext<{ qc: QueryClient }>()({ component: Outlet });

const publica = <const P extends string>(path: P) => ({ getParentRoute: () => raiz, path });

const login = createRoute({
  ...publica('/login'),
  validateSearch: (s: Record<string, unknown>): { redirect?: string; error?: string } => ({
    redirect: rutaInterna(s.redirect),
    error: b.texto(s.error),
  }),
  component: lazyRouteComponent(() => import('./rutas/auth/Login'), 'Login'),
});
const noHabilitado = createRoute({
  ...publica('/no-habilitado'),
  component: lazyRouteComponent(() => import('./rutas/auth/Paginas'), 'NoHabilitado'),
});
const recuperar = createRoute({
  ...publica('/recuperar'),
  component: lazyRouteComponent(() => import('./rutas/auth/Recuperar'), 'Recuperar'),
});
const restablecer = createRoute({
  ...publica('/restablecer'),
  component: lazyRouteComponent(() => import('./rutas/auth/Paginas'), 'Restablecer'),
});

const app = createRoute({
  getParentRoute: () => raiz,
  id: 'app',
  beforeLoad: async ({ context, location }): Promise<{ usuario: UsuarioActual }> => {
    try {
      return { usuario: await context.qc.ensureQueryData(qSesion) };
    } catch (e) {
      if (e instanceof ErrorApiCliente && (e.status === 401 || e.status === 403))
        throw redirect({
          to: '/login',
          search: { redirect: location.pathname === '/' ? undefined : rutaInterna(location.href) },
        });
      throw e;
    }
  },
  component: lazyRouteComponent(() => import('./rutas/app/Armazon'), 'Armazon'),
});

const exigir =
  (permitido: (u: UsuarioSesion) => boolean) =>
  ({ context }: { context: { usuario: UsuarioActual } }) => {
    if (!permitido(context.usuario)) throw redirect({ to: '/' });
  };
const soloStaff = exigir(esStaff);
const soloAdmin = exigir(esAdmin);
const privada = <const P extends string>(path: P) => ({ getParentRoute: () => app, path });

const inicio = createRoute({
  ...privada('/'),
  beforeLoad: ({ context }) => {
    throw redirect({ to: esStaff(context.usuario) ? '/kanban' : '/mis-pedidos', replace: true });
  },
});
const nuevo = createRoute({
  ...privada('/nuevo'),
  validateSearch: (s: Record<string, unknown>): { categoria?: number } => ({ categoria: b.entero(s.categoria) }),
  component: lazyRouteComponent(() => import('./rutas/solicitante/Nuevo'), 'Nuevo'),
});
const misPedidos = createRoute({
  ...privada('/mis-pedidos'),
  validateSearch: (s: Record<string, unknown>): { ambito?: 'area' } => ({
    ambito: s.ambito === 'area' ? 'area' : undefined,
  }),
  component: lazyRouteComponent(() => import('./rutas/solicitante/MisPedidos'), 'MisPedidos'),
});
const ticket = createRoute({
  ...privada('/tickets/$id'),
  validateSearch: (s: Record<string, unknown>): { calificar?: number } => ({
    calificar: b.bandera(s.calificar) ? 1 : undefined,
  }),
  component: lazyRouteComponent(() => import('./rutas/ticket/Ticket'), 'PaginaTicket'),
});
const kanban = createRoute({
  ...privada('/kanban'),
  beforeLoad: soloStaff,
  validateSearch: (s: Record<string, unknown>): import('./lib/kanban').FiltrosKanban => ({
    mios: b.bandera(s.mios),
    sinAsignar: b.bandera(s.sinAsignar),
    vencidos: b.bandera(s.vencidos),
    area: b.entero(s.area),
    categoria: b.entero(s.categoria),
    prioridad: b.uno(s.prioridad, PRIORIDADES),
    q: b.texto(s.q),
  }),
  component: lazyRouteComponent(() => import('./rutas/kanban/Kanban'), 'Kanban'),
});
const lista = createRoute({
  ...privada('/lista'),
  beforeLoad: soloStaff,
  validateSearch: (s: Record<string, unknown>): b.BusquedaLista => ({
    ambito: b.uno(s.ambito, ['mios', 'area', 'todos'] as const),
    estado: b.varios(s.estado, ESTADOS),
    prioridad: b.varios(s.prioridad, PRIORIDADES),
    areaId: b.entero(s.areaId),
    categoriaId: b.entero(s.categoriaId),
    asignadoId: b.texto(s.asignadoId),
    sinAsignar: b.bandera(s.sinAsignar),
    vencidos: b.bandera(s.vencidos),
    q: b.texto(s.q),
    orden: b.uno(s.orden, b.ORDENES_LISTA),
    dir: b.uno(s.dir, ['asc', 'desc'] as const),
    pagina: b.entero(s.pagina),
    porPagina: b.entero(s.porPagina),
  }),
  component: lazyRouteComponent(() => import('./rutas/lista/Lista'), 'Lista'),
});
const tablero = createRoute({
  ...privada('/tablero'),
  beforeLoad: soloStaff,
  validateSearch: (s: Record<string, unknown>): { desde?: string; hasta?: string; areaId?: number; categoriaId?: number } => ({
    desde: b.fecha(s.desde),
    hasta: b.fecha(s.hasta),
    areaId: b.entero(s.areaId),
    categoriaId: b.entero(s.categoriaId),
  }),
  component: lazyRouteComponent(() => import('./rutas/tablero/Tablero'), 'Tablero'),
});

const categorias = createRoute({
  ...privada('/admin/categorias'),
  beforeLoad: soloAdmin,
  component: lazyRouteComponent(() => import('./rutas/admin/Categorias'), 'Categorias'),
});
const usuarios = createRoute({
  ...privada('/admin/usuarios'),
  beforeLoad: soloAdmin,
  component: lazyRouteComponent(() => import('./rutas/admin/Usuarios'), 'Usuarios'),
});
const areas = createRoute({
  ...privada('/admin/areas'),
  beforeLoad: soloAdmin,
  component: lazyRouteComponent(() => import('./rutas/admin/Areas'), 'Areas'),
});
const configuracion = createRoute({
  ...privada('/admin/configuracion'),
  beforeLoad: soloAdmin,
  component: lazyRouteComponent(() => import('./rutas/admin/Configuracion'), 'PaginaConfiguracion'),
});
const colas = createRoute({
  ...privada('/admin/colas'),
  beforeLoad: soloAdmin,
  component: lazyRouteComponent(() => import('./rutas/admin/Colas'), 'Colas'),
});

const arbol = raiz.addChildren([
  login,
  noHabilitado,
  recuperar,
  restablecer,
  app.addChildren([inicio, nuevo, misPedidos, ticket, kanban, lista, tablero, categorias, usuarios, areas, configuracion, colas]),
]);

export function crearRouter(qc: QueryClient) {
  return createRouter({
    routeTree: arbol,
    context: { qc },
    defaultPreload: 'intent',
    defaultPendingMs: 150,
    scrollRestoration: true,
    defaultPendingComponent: () => <Cargando />,
    defaultErrorComponent: ({ error, reset }) => (
      <ErrorVista
        error={error}
        reintentar={() => {
          reset();
          window.location.reload();
        }}
      />
    ),
    defaultNotFoundComponent: () => <ErrorVista error={{ status: 404 }} />,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof crearRouter>;
  }
}
