# Contrato HTTP

Esquemas Zod en `packages/shared/src/schemas`. Errores: `{ error, mensaje, detalles? }` (`zError`).
Autenticación por cookie `eco_sesion` (JWT, 15 min) + `eco_refresh` (opaco, rotativo, `Path=/api/auth`).
Ante `401 no_autenticado` la web llama a `POST /api/auth/refresh` una vez y reintenta.
CSRF: cookies SameSite=Lax y rechazo de mutaciones cuyo `Origin` no sea el de `APP_URL`.
Roles: P público · A autenticado · S staff (técnico/admin) · AD admin.

| Método y ruta | Rol | Entrada → salida | Dueño |
|---|---|---|---|
| GET `/api/health` | P | → `{ ok, db, version }` (503 si no hay DB) | backend |
| GET `/api/docs` | P | OpenAPI (Swagger UI) | backend |
| GET `/auth/portal?token&redirect` | P | JWT del portal → 303 a la ruta (sesión) o a `/no-habilitado` / `/login?error=...`. También `Authorization: Bearer` | backend |
| POST `/auth/portal` | P | `zPortalBody` (JSON o form) → igual que GET | backend |
| GET `/api/auth/config` | P | → `zAuthConfig` | backend |
| GET `/api/auth/altcha` | P | → desafío ALTCHA | backend |
| POST `/api/auth/login` | P | `zLogin` → `zUsuarioSesion` | backend |
| POST `/api/auth/dev/token` | P (solo dev, 404 en prod) | `zDevToken` → `{ url }` | backend |
| POST `/api/auth/recuperar` | P | `zRecuperar` → `zOk` (siempre igual) | backend |
| POST `/api/auth/restablecer` | P | `zRestablecer` → `zOk` | backend |
| POST `/api/auth/refresh` | P (cookie) | → `zUsuarioSesion` | backend |
| POST `/api/auth/logout` | P | → `{ redirigirA }` | backend |
| GET `/api/auth/yo` | A | → `zUsuarioSesion` | backend |
| GET `/api/sso/usuario-existe?email` | `X-Portal-Key` | → `zUsuarioExiste` | backend |
| GET `/api/catalogo` | A | → `zCatalogo` (categorías inactivas solo admin) | backend |
| GET `/api/tickets` | A | `zFiltroTickets` → `zPaginaTickets` | backend |
| POST `/api/tickets` | A | `zCrearTicket` → 201 `zTicketDetalle` | backend |
| GET `/api/tickets/exportar.csv` | S | `zFiltroTickets` → CSV (BOM, `;`) | backend |
| POST `/api/tickets/masivo` | S | `zAccionMasiva` → `zResultadoMasivo` | backend |
| GET `/api/kanban` | S | → `zKanban` | backend |
| GET `/api/tickets/:id` | A* | acepta uuid o código → `zTicketDetalle` | backend |
| PATCH `/api/tickets/:id` | A* | `zActualizarTicket` → `zTicketDetalle`; 409 `conflicto_version` con `detalles.ticket` | backend |
| PATCH `/api/tickets/:id/mover` | S | `zMoverTicket` → `zTicketResumen`; 409 igual | backend |
| POST `/api/tickets/:id/reabrir` | A* | `zReabrir` → `zTicketDetalle` | backend |
| POST `/api/tickets/:id/calificar` | dueño | `zCalificar` → `zTicketDetalle` | backend |
| GET `/api/tickets/:id/mensajes` | A* | → `{ items: Mensaje[] }` (sin internas para solicitantes) | backend |
| POST `/api/tickets/:id/mensajes` | A* | `zCrearMensaje` → 201 `zMensaje` | backend |
| PATCH `/api/mensajes/:id` | autor | `zEditarMensaje` → `zMensaje` | backend |
| GET `/api/tickets/:id/eventos` | A* | → `{ items: TicketEvento[] }` (solicitantes: sin eventos `sla_*`) | backend |
| POST `/api/tickets/:id/lectura` | A* | `zLectura` → `zOk` | backend |
| POST `/api/tickets/:id/adjuntos?mensajeId` | A* | multipart `archivo` → 201 `zAdjunto` | backend |
| GET `/api/adjuntos/:id?descargar=1` | A* | binario | backend |
| GET `/api/no-leidos` | A | → `zNoLeidos` (staff: tickets asignados o en los que participó; solicitante: los suyos) | backend |
| GET `/api/notificaciones` | A | → `zListaNotificaciones` (50 últimas) | backend |
| POST `/api/notificaciones/leer` | A | `zMarcarNotificaciones` → `zOk` | backend |
| GET `/api/estadisticas` | S | `zFiltroEstadisticas` → `zEstadisticas` | backend |
| POST/PUT/DELETE `/api/admin/categorias[/:id]` | AD | `zGuardarCategoria` → `zCategoria` (DELETE desactiva) | backend |
| PUT `/api/admin/categorias/orden` | AD | `zOrdenCategorias` → `zOk` | backend |
| POST/PUT `/api/admin/areas[/:id]` | AD | `zGuardarArea` → `zArea` | backend |
| GET/POST `/api/admin/usuarios` | AD | `zFiltroUsuarios` / `zCrearUsuario` → `zPaginaUsuarios` / `zUsuario` | backend |
| PATCH `/api/admin/usuarios/:id` | AD | `zActualizarUsuario` → `zUsuario` | backend |
| PUT `/api/admin/configuracion` | AD | `zConfiguracion` → `zConfiguracion` | backend |
| POST/PUT/DELETE `/api/admin/respuestas[/:id]` | S | `zGuardarRespuestaRapida` → `zRespuestaRapida` | backend |
| GET `/api/admin/colas` | AD | → `{ items: ResumenCola[] }` | realtime-colas |
| GET `/api/admin/colas/:nombre/trabajos` | AD | `zFiltroTrabajos` → `{ items: Trabajo[] }` | realtime-colas |
| POST `/api/admin/colas/:nombre/trabajos/:id/reintentar` y `/cancelar` | AD | → `zOk` | realtime-colas |
| GET `/dev/mails`, `/dev/mails/:archivo` | P (solo dev) | HTML | realtime-colas |

`A*` = autenticado y con `puedeVerTicket`; para escribir además `puedeEscribirTicket`. Un ticket ajeno
responde **404** (no revela existencia).

## Rutas de la web
`/login`, `/no-habilitado`, `/recuperar`, `/restablecer?token=`, `/` (redirige según rol), `/nuevo`,
`/mis-pedidos`, `/tickets/:id` (acepta código; `?calificar=1`), `/kanban`, `/lista`, `/tablero`,
`/admin/categorias`, `/admin/usuarios`, `/admin/areas`, `/admin/configuracion`, `/admin/colas`.
