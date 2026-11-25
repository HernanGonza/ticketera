# Web de ECOsoporte (`@eco/web`)

SPA con React 19, Vite, TanStack Query/Router/Table/Virtual, dnd-kit, Tailwind 4, ECharts y Socket.IO.

## Comandos (desde la raíz)

| Comando | Qué hace |
|---|---|
| `npm run dev -w @eco/web` | Vite en `WEB_PORT` (5173) con proxy a `API_PORT` (3000) |
| `npm run typecheck -w @eco/web` | Tipos de `src` y `test` |
| `npm run build -w @eco/web` | Compila a `apps/web/dist` |
| `node apps/web/scripts/medir-bundle.mjs` | Gzip del JS inicial; falla si supera 150 KB (`LIMITE_KB`) |
| `npx vitest run --project unit apps/web` | Tests unitarios |

## Estructura

```
src/
  main.tsx, router.tsx    arranque, árbol de rutas (carga diferida) y guardas por rol
  styles/                 tokens.css (único lugar con colores) y base.css (tema Tailwind)
  lib/                    lógica sin interfaz
    api.ts                cookies, refresh único ante 401, ErrorApiCliente
    consultas.ts          claves y opciones de TanStack Query
    cache.ts              conciliación de versiones, parches optimistas, mensajes
    optimista.ts          mutaciones de tickets en cola, reversión y conflicto de versión
    socket.ts             único socket (fragmento diferido)
    eventos-vivo.ts       evento del servidor -> caché
    vivo.ts               conexión, presencia, "escribiendo" y salas
    kanban.ts, sla.ts     orden, destino del arrastre, filtros y plazos
  componentes/            marca (flor, firma), controles, diálogos y menús, adjuntos
  rutas/                  una carpeta por pantalla: auth, app (armazón), solicitante, ticket,
                          kanban, lista, tablero, admin
scripts/                  favicon.mjs (se pinta desde tokens.css) y medir-bundle.mjs
test/                     unitarios (caché, optimismo, kanban, formulario, API, contraste)
```

## Reglas

- Colores solo en `src/styles/tokens.css` (hexadecimales); `test/contraste.test.ts` verifica AA en ambos temas.
- De `@eco/shared/schemas` solo `import type`.
- El paquete inicial no debe incluir zod, ECharts, react-markdown, ALTCHA, dnd-kit ni la tabla.
- Toda escritura de tickets en caché pasa por `structuralSharing` (`cache.ts`): ignora versiones viejas y
  conserva referencias para evitar parpadeos.

## `data-testid` estables para E2E

| `data-testid` | Elemento | Atributos útiles |
|---|---|---|
| `seccion-<estado>` | Columna o sección de «Mis pedidos» de un estado (las plegadas, solo si tienen pedidos) | |
| `columna-<estado>` | Columna del kanban (`nuevo`, `asignado`, `en_curso`, `en_espera`, `resuelto`, `cerrado`) | `data-valida` durante un arrastre |
| `tarjeta-<codigo>` | Tarjeta del kanban y fila de "Mis pedidos" | |
| `avatar-tecnico-<id>` | Destino de asignación (`avatar-tecnico-ninguno` = sin asignar) | |
| `chat-entrada`, `chat-enviar` | Campo y botón del chat | |
| `chat-publico`, `chat-interno` | Visibilidad del mensaje (staff) | |
| `mensaje` | Cada mensaje | `data-interno` |
| `escribiendo` | Indicador "está escribiendo" | |
| `presencia` | Otras personas viendo el ticket | |
| `conexion` | Estado del tiempo real | `data-estado="conectado\|desconectado"` |
| `estado-ticket` | Estado en el detalle | `data-estado` |
| `gestion-estado`, `gestion-prioridad`, `gestion-categoria`, `gestion-asignado` | Selectores del técnico | |
| `categoria-<id>` | Categoría en "Nuevo pedido" | |
| `codigo-confirmacion` | Código del pedido creado | |
| `no-leidos-total`, `menu-usuario`, `altcha` | Cabecera e ingreso | |
| `kanban-buscar`, `filtro-mios`, `filtro-sinAsignar`, `filtro-vencidos` | Filtros del kanban | |
| `fila-<codigo>`, `acciones-masivas`, `exportar-csv` | Lista | |
| `kpis`, `grafico-<id>`, `exportar-tablero-csv` | Estadísticas (`semanal`, `backlog`, `areas`, `categorias`, `respuesta`, `resolucion`, `sla`, `tecnicos`, `calor`) | |
| `fila-categoria-<id>`, `vista-previa`, `cola-<nombre>` | Administración | |

Notas para automatizar:

- El kanban está virtualizado: una tarjeta fuera de la vista no está en el DOM (use la búsqueda).
- Arrastre con puntero: mover al menos 5 px tras presionar. Con teclado: foco en el botón `Mover <codigo>`,
  espacio, flechas, espacio. También existe el menú `Acciones de <codigo>`.
- El botón "Ingresar" del login se habilita cuando el widget ALTCHA queda verificado (casilla del widget).

## Producción

Archivos estáticos con reescritura a `index.html`. La política de contenidos necesita
`style-src 'unsafe-inline'` (sonner) y no necesita `unsafe-eval`.
