# ECOsoporte — Especificación

Ticketera interna del Ministerio de Ecología y RNR de Misiones: todas las áreas piden soporte
técnico y Desarrollo/Soporte lo gestiona con kanban, mensajería en tiempo real y estadísticas.

## 1. Restricciones duras

- Sin Supabase, Firebase, Pusher, Ably, Redis ni otro servicio externo de backend/realtime.
- PostgreSQL 16 propio. Una sola pieza de infraestructura: Postgres.
- **Desarrollo local sin Docker**. `npm install && npm run dev` levanta todo: Postgres embebido
  (`embedded-postgres`, `./.data/pg`, puerto 5433) o `DATABASE_URL`, migraciones + seed idempotentes, API,
  worker y web con hot reload (`concurrently`). Solo requiere Node 22+.
- **Despliegue con Docker**: `cp .env.example .env && docker compose up -d --build`. Migraciones y seed
  automáticos. No se prueba en vivo: se revisa, los comandos internos se prueban localmente con los mismos
  scripts npm, y se aclara en `docs/INFORME_FINAL.md`.
- npm workspaces (no pnpm/yarn). TypeScript estricto. Interfaz en español institucional ("usted").
- Zona horaria `America/Argentina/Buenos_Aires`; fechas `dd/mm/aaaa HH:mm`.
- Sin dependencias pagas; licencias MIT/Apache/BSD/ISC preferidas.
- Scripts npm portables (Windows, Linux, macOS): sin comandos bash; scripts Node / `cross-env`.
- **Prioridad absoluta: velocidad** (carga inicial, interacción, tiempo real).

## 2. Stack

| Capa | Tecnología |
|---|---|
| Monorepo | npm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/shared` |
| API | Node 22 + Fastify + Zod; OpenAPI en `/api/docs` |
| ORM | Drizzle ORM + drizzle-kit (migraciones SQL versionadas) |
| Colas | pg-boss (reintentos, backoff, cron) |
| Tiempo real | Socket.IO + `@socket.io/postgres-adapter` |
| Worker | proceso separado `apps/worker` |
| Web | React 19 + Vite (SPA), TanStack Query/Router/Table/Virtual, dnd-kit, Tailwind 4 + componentes estilo shadcn/ui, Apache ECharts, react-hook-form + zod, code splitting por ruta |
| Proxy (producción) | Caddy; en local el proxy de Vite |
| Mail | SMTP por `.env`; sin `SMTP_HOST` en local se guarda en `./.data/mails/*.html`, listados en `/dev/mails` (solo dev) |
| Tests | Vitest unit + integración (Postgres embebido, base temporal); Playwright E2E |
| Estadísticas avanzadas | Metabase en perfil `stats` con usuario de solo lectura |

**Metas de performance** (medir y reportar): JS inicial < 150 KB gzip; LCP < 1,5 s en local;
kanban a 60 fps con 500 tarjetas; evento realtime visible en otro navegador < 300 ms.

## 3. Marca

Fuentes, en orden: `docs/marca/` (brandbook 2024 y fuentes), la Wiki del Ministerio, y los tokens base:
`--eco-verde #3E6C51`, `--eco-texto #231F20`, `--eco-lapacho #C9346C`, `--eco-lapacho-claro #F5A5BF`,
`--eco-beige #F7F5F2`, `--eco-blanco #FFFFFF`.

- Oak Sans servida desde la app (`apps/web/public/fonts`), fallback `Inter, system-ui, sans-serif`.
- Flor del Lapacho: 5 pétalos con degradé lapacho → claro, nervaduras blancas, respiración/balanceo sutil
  (sin pétalos volando). En login, estados vacíos y loader.
- Header con firma conjunta Ministerio de Ecología y RNR + Gobierno de Misiones. Nombre **ECOsoporte** en una
  sola constante (`packages/shared/src/marca.ts`).
- Tokens en `apps/web/src/styles/tokens.css` + theme Tailwind. Prohibido hardcodear colores fuera de ellos.
- Modo claro por defecto, oscuro opcional derivado. Estados y prioridades derivados de la paleta (sin azul
  genérico). Contraste AA. Responsive (los solicitantes cargan desde el celular).

## 4. Dominio

### Roles
`solicitante` (cualquier empleado: crea, ve los suyos y los de su área si está habilitado, comenta, adjunta,
califica); `tecnico` (ve y gestiona todo, notas internas); `admin` (además categorías, SLA, usuarios, áreas,
configuración).

### Autenticación: Ingreso Único del Ministerio

Contexto (decisión ya tomada para todos los sistemas): un portal central
(`portal.ecologia.misiones.gob.ar`) autentica contra la DB del sistema de Personal y emite un JWT; cada
sistema valida al usuario **por email** contra su propia base; el portal consulta a cada sistema si el mail
existe para armar la botonera; cada sistema conserva login propio de respaldo; captcha ALTCHA autoalojado
(doble factor más adelante).

1. **Entrada** — `GET /auth/portal?token=<JWT>`, `Authorization: Bearer <JWT>` y `POST /auth/portal` con
   `token` en el body.
   - Validar firma, `exp`, `iss`, `aud`. `PORTAL_JWT_ALG` (`HS256`|`RS256`), `PORTAL_JWT_SECRET` o
     `PORTAL_JWT_PUBLIC_KEY`/`PORTAL_JWT_JWKS_URL`, `PORTAL_JWT_ISSUER`, `PORTAL_JWT_AUDIENCE` (opcional).
     Tolerancia de reloj 30 s.
   - Claims: `email` (obligatorio), `nombre`, `sub`; ignorar desconocidos. Mapeo en una sola función
     `mapearClaimsPortal`.
   - Buscar usuario por email sin distinguir mayúsculas (índice único `lower()` o citext). Si no existe y está
     en Personal → crear como `solicitante`. Si no está en Personal → pantalla "Su usuario no está habilitado"
     con contacto `desarrollo@ecologia.misiones.gob.ar`.
   - Sesión propia: cookie httpOnly, Secure en producción, SameSite=Lax, sesión corta + refresh rotativo en DB
     (revocable). El JWT del portal no se usa como sesión ni se guarda.
   - Redirigir a `?redirect=` validado contra rutas internas y quitar el token de la URL (no en historial ni
     logs: excluir `token` del logger).
   - Anti reuso: guardar `jti` (si viene) con TTL y rechazar repetidos.
2. **Botonera del portal** — `GET /api/sso/usuario-existe?email=`: header `X-Portal-Key` = `PORTAL_API_KEY`,
   comparación en tiempo constante, rate limit. Responde `{ existe, rol? }`; `existe: true` para cualquier
   email presente en Personal aunque nunca haya entrado. Documentar en README.
3. **Login de respaldo** (`/login`): email + contraseña (argon2id) + ALTCHA (`altcha` + `altcha-lib`). Rate
   limit por IP y por email. Botón principal "Ingresar con el Portal del Ministerio" (a `PORTAL_URL`) y debajo
   el formulario. Recupero de contraseña por mail con token de un solo uso.
4. **Logout**: borra la sesión local y redirige a `PORTAL_URL` (`PORTAL_LOGOUT_URL` configurable).
5. **Personal**: `PersonalProvider.buscarPorEmail(email) → { nombre, area_id, area_nombre, activo } | null`.
   `PersonalPostgresProvider` (si `PERSONAL_DATABASE_URL`, solo lectura; tabla/columnas en un único archivo) y
   `PersonalMockProvider` (default local, empleados del seed). En cada ingreso se actualizan nombre, área y
   estado; inactivo en Personal = acceso bloqueado.
6. **Dev sin portal**: `npm run dev:token -- --email <email>` firma un JWT de prueba e imprime la URL. En
   `/login` en modo dev: accesos rápidos "Entrar como solicitante / técnico / admin" con el mismo flujo.
7. **Tests obligatorios**: token válido, vencido, firma inválida, `iss` incorrecto, email inexistente en
   Personal, usuario inactivo, reuso de `jti`, `usuario-existe` sin clave / clave incorrecta / correcta.

### Estados y prioridad
`nuevo → asignado → en_curso → en_espera → resuelto → cerrado` + `cancelado`. Máquina de estados en
`packages/shared` (API y web); el kanban solo permite soltar en columnas válidas. `en_espera` pausa el SLA.
`resuelto` → `cerrado` automático a las 72 h hábiles si no se reabre; al resolver se pide calificación 1–5.
Reabrir desde `resuelto` incrementa `reabierto`. Prioridad `baja|media|alta|critica`, default por categoría.

### Tablas mínimas
`areas`; `usuarios` (uuid, email único, nombre, area_id, rol, password_hash nullable, activo, ultimo_acceso);
`categorias` (nombre, icono, padre_id, prioridad_default, sla_respuesta_min, sla_resolucion_min, campos jsonb,
asignación por defecto, activa, orden); `tickets` (id, codigo `TCK-AAAA-000001` por secuencia anual, titulo,
descripcion, categoria_id, prioridad, estado, solicitante_id, area_id histórica, asignado_id,
ubicacion/interno, datos jsonb, orden_kanban numeric, creado_at, actualizado_at, primera_respuesta_at,
resuelto_at, cerrado_at, vence_respuesta_at, vence_resolucion_at, minutos_en_espera, en_espera_desde,
reabierto, calificacion, comentario_calificacion, version); `ticket_eventos` (historial inmutable: base de las
estadísticas); `mensajes` (markdown, interno, editado_at); `adjuntos` (ticket/mensaje, ruta, nombre, mime,
bytes; tipo y tamaño máximo configurables); `lecturas`; `notificaciones`; `outbox_eventos`; `configuracion`
(horario hábil, feriados, horas de autocierre…); vista `v_tickets_metricas` (min_primera_respuesta,
min_resolucion sin espera, cumple_sla) y las que pida el tablero.

**Seed**: 8 áreas, 12 categorías con íconos (Internet/Red, Wi-Fi, PC no enciende, Impresora, Correo,
Alta/baja de usuario, Sistemas del Ministerio, Telefonía/interno, Software/instalación, Proyector/sala,
Cámaras, Otro), 3 técnicos, 1 admin, 20 solicitantes, ~300 tickets en 90 días con eventos coherentes.

## 5. Tiempo real

1. Toda mutación escribe en la misma transacción una fila en `outbox_eventos`.
2. El worker publica el outbox (LISTEN/NOTIFY + polling de respaldo) vía emitter del postgres-adapter y marca
   `publicado_at`.
3. La API corre Socket.IO con salas `ticket:{id}` (mensajes, estado, asignación, adjuntos, "está
   escribiendo…", presencia), `tecnicos`, `usuario:{id}`, `tablero`.
4. Socket autenticado con la cookie de sesión; autorización por sala.
5. Reconexión automática con re-sincronización (invalidar queries).

Frontend: `setQueryData`/`invalidateQueries` por evento; `React.memo` y selectores; optimismo en drag & drop,
asignación, prioridad y mensajes, con rollback y toast "Otro técnico modificó este ticket" ante conflicto de
`version`; indicador de conexión; no leídos por ticket y global; notificación del navegador y sonido opcional
para técnicos ante ticket nuevo o crítico.

## 6. Colas (pg-boss)

`notificaciones-mail` (alta a solicitante y técnicos de la categoría, asignación, cambio de estado, mensaje
con agrupado de 2 min, resolución con link para calificar; plantillas HTML con marca; backoff exponencial),
`sla` (cada minuto; 80 % y vencidos), `autocierre`, `asignacion-automatica` (técnico por defecto o
round-robin por menor carga), `outbox-publisher`. Panel propio `/admin/colas` (solo admin): pendientes,
activos, fallidos y completados por cola, reintentar/cancelar, leyendo las tablas de pg-boss.

## 7. Pantallas

- **Solicitante**: *Nuevo pedido* (grilla de categorías → formulario dinámico, título, descripción,
  ubicación/interno, adjuntos con arrastre y Ctrl+V; confirmación con código); *Mis pedidos* (estado, último
  mensaje, no leídos); *Detalle* (línea de tiempo, chat en vivo, vista previa de adjuntos, Reabrir,
  calificación).
- **Técnico**: *Kanban* (columnas por estado, arrastre entre y dentro de columnas persistiendo orden; tarjetas
  con código, título, área, categoría, prioridad, avatar, barra de SLA, no leídos; filtros: míos, sin asignar,
  área, categoría, prioridad, vencidos, búsqueda; soltar sobre avatar asigna); *Lista* (TanStack Table,
  filtros, orden, columnas configurables, selección múltiple con acciones masivas, CSV); *Detalle técnico*
  (notas internas diferenciadas, estado/prioridad/categoría/asignado, respuestas rápidas, historial).
- **Admin**: categorías (CRUD, editor visual de campos, SLA, orden por arrastre), usuarios y roles, áreas,
  horario hábil y feriados, configuración, colas.
- **Tablero** (técnicos, en vivo): KPIs (abiertos, sin asignar, vencidos, por vencer, creados y resueltos
  hoy); mediana de primera respuesta y resolución (general y por categoría); % SLA; creados vs resueltos por
  semana; backlog acumulado; ranking de áreas y categorías; carga/resueltos/calificación por técnico; mapa de
  calor día × hora; tasa de reabiertos; filtros de fecha, área y categoría; exportar CSV/PNG.
- **Generales**: login con flor animada, header con firma, sidebar colapsable, campana, estados vacíos,
  skeletons, toasts, atajos del kanban (`/` buscar, `n` nuevo), drag & drop accesible.

## 8. Despliegue

`docker-compose.yml`: `db` (postgres:16-alpine, `pgdata`, healthcheck), `api` (multi-stage, no root, espera
healthy, migra + seed, healthcheck `/api/health`), `worker` (misma imagen), `proxy` (Caddy con el build web,
`${APP_PORT:-8080}`), `metabase` (perfil `stats`). Volúmenes `pgdata`, `uploads`. Solo el proxy expone
puerto. `.env.example` comentado (local y producción). `restart: unless-stopped`. `.dockerignore`.

Scripts raíz: `dev`, `dev:api`, `dev:worker`, `dev:web`, `dev:token`, `db:start`, `db:stop`, `db:migrate`,
`db:seed`, `db:reset`, `test`, `e2e`, `build`, `typecheck`, `lint`, `docker:up`, `docker:down`,
`docker:logs`, `backup-db`.

## 9. Seguridad

Autorización en cada endpoint y sala (con tests); Zod en toda entrada; markdown sin HTML crudo; adjuntos con
MIME real, tamaño máximo, nombres aleatorios, solo autenticados y `Content-Disposition` correcto; headers de
seguridad en Caddy (CSP, HSTS opcional); CORS cerrado; secretos solo en `.env`; logs pino sin datos sensibles.

## 10. Equipo, fases y criterios

Roles: arquitecto (contratos, integración; raíz y `packages/shared`), db (`apps/api/src/db`), backend
(`apps/api`), realtime-colas (`apps/api/src/realtime`, `apps/worker`), frontend (`apps/web`), devops-qa
(`docker/`, `tests/`, raíz), revisor. Commits chicos en español con prefijo. Nadie cambia contratos sin el
arquitecto y sin registrar en `DECISIONES.md`. Tras cada fase: revisor + suite completa. 3 intentos fallidos →
escalar.

1. **Contratos y esqueleto** — `npm install && npm run dev` levanta y `/api/health` responde con DB conectada.
2. **db, backend, realtime-colas, frontend** — unit e integración verdes.
3. **Integración y tablero** — E2E: (a) pedido desde celular aparece sin recargar en el kanban de otro
   navegador; (b) arrastre a "En curso" visible en vivo para el solicitante; (c) chat bidireccional con "está
   escribiendo…"; (d) conflicto de dos técnicos resuelto bien; (e) solicitante no ve tickets ni salas ajenas.
4. **Pulido** — capturas de cada pantalla en `docs/capturas/` (Playwright), accesibilidad, performance (500
   tickets), README.

**Definición de terminado**: arranque limpio en `http://localhost:5173` con seed; usuarios de prueba en
README; `npm test && npm run e2e` verdes; `npm run build` y `npm run typecheck` sin errores; Docker completo y
revisado; metas de performance reportadas; sin Supabase/Redis/externos; capturas; README (arquitectura
mermaid, arranque, variables, JWT del portal, DB de Personal, backups, tests); `docs/PLAN.md` tildado;
`docs/INFORME_FINAL.md`. Verificación final desde cero (borrando `node_modules` y `.data`).
