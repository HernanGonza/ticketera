# Plan

## Fase 1 — Contratos y esqueleto (arquitecto + devops-qa)
- [x] Documentos (`CLAUDE.md`, SPEC, PLAN, DECISIONES, API) y marca en `docs/marca/`
- [x] Monorepo npm y `packages/shared` (schemas, dominio, estados, eventos, colas)
- [x] Postgres embebido + API + worker + web con `npm run dev`; `/api/health` con DB
- [x] Dockerfiles y compose iniciales (devops-qa)

## Fase 2 — Construcción
- [x] db: esquema, migraciones, vistas, índices, seed, operaciones de dominio y consultas
- [x] backend: auth (portal, local, recupero, usuario-existe), tickets, mensajes, adjuntos, admin, estadísticas
- [x] realtime-colas: Socket.IO, outbox, pg-boss, mails, SLA, autocierre, asignación, panel de colas
- [x] frontend: marca, shell, solicitante, kanban, lista, detalle con chat
- [x] Tests unitarios e integración verdes
- [ ] Revisión de fase

## Fase 3 — Integración y tablero
- [x] Tablero de estadísticas, admin, notificaciones
- [ ] Integración completa API + worker + web
- [ ] E2E (a) alta desde celular visible en vivo · (b) arrastre en vivo · (c) chat y "escribiendo" · (d) conflicto · (e) aislamiento
- [ ] Revisión de fase

## Fase 4 — Pulido y entrega
- [ ] Capturas en `docs/capturas/` y revisión de marca
- [ ] Accesibilidad
- [ ] Performance (500 tarjetas, metas medidas)
- [ ] README e INFORME_FINAL
- [ ] Verificación final desde cero
