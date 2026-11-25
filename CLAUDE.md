# ECOsoporte — reglas del repo

Ticketera del Ministerio de Ecología y RNR. Especificación: `docs/SPEC.md`. Contratos: `packages/shared` y
`docs/API.md`. Plan: `docs/PLAN.md`. Decisiones: `docs/DECISIONES.md`.

## Comandos (Node 22+, solo npm)
- `npm install && npm run dev` → Postgres embebido (5433) + migraciones + seed + API (3000) + worker + web (5173)
- `npm test` (unit + integración) · `npm run test:unit` · `npx vitest run --project integracion <ruta>`
- `npm run e2e` (stack aislado: `.data-e2e`, puertos 5435/3101/5174)
- `npm run typecheck` · `npm run lint` · `npm run build`
- `npm run db:generate|db:migrate|db:seed|db:reset` · `npm run dev:token -- --email <email>`
- En esta máquina **no se ejecuta Docker** (ni `docker` ni `docker compose`).

## Convenciones
- TypeScript estricto, ESM, sin `any` injustificado. Identificadores del dominio en español; columnas SQL en
  snake_case; JSON en camelCase.
- Textos al usuario en español institucional, tratando de "usted". Fechas `dd/mm/aaaa HH:mm`, zona
  `America/Argentina/Buenos_Aires` (usar `@eco/shared/dominio`).
- Reglas de negocio puras en `packages/shared/src/dominio`; no duplicarlas.
- **No cambiar contratos de `packages/shared` ni `docs/API.md` sin el arquitecto**; registrar en DECISIONES.
- Toda mutación escribe su evento en `outbox_eventos` en la misma transacción. La API no encola ni emite
  sockets directamente (salvo presencia/"escribiendo", que son efímeros).
- Autorización en cada endpoint y sala, con test. Ticket ajeno → 404.
- En la web: colores solo desde `src/styles/tokens.css`; no importar `@eco/shared/schemas` (zod) en código del
  bundle inicial, solo `import type`.
- Nunca registrar tokens, contraseñas ni cookies. `.env` no se commitea.
- Scripts portables (sin bash en `package.json`).
- Commits chicos en español con prefijo `feat:`/`fix:`/`chore:`/`test:`/`docs:`.

## Carpetas y responsables
`packages/shared` arquitecto · `apps/api/src/db` db · `apps/api` backend · `apps/api/src/{realtime,colas}` y
`apps/worker` realtime-colas · `apps/web` frontend · `docker/`, `tests/`, `scripts/`, raíz: devops-qa.
