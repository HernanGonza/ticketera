# Punto de pausa (25/11/2026) — borrar este archivo al terminar

Estado en `54baa40`: fases 1 a 3 construidas e integradas. Última corrida (reportada por devops-qa):
`npm test` 384/384, typecheck/lint/build bien, E2E 84/84 dos veces, capturas 34/34, performance dentro de
meta (`docs/PERFORMANCE.md`). Los agentes de corrección se detuvieron antes de commitear cambios.

## 0. Pedido del usuario al pausar (prioridad al retomar)

Forma de trabajo acordada: sin subagentes, tandas chicas y parar para que el usuario revise.
Hecho (tanda 1): «Mis pedidos» separado por estado y menú de empleados sin barra lateral. Falta el resto.

- **La UX/UI no está bien: tiene que ser más simple.** Revisar todas las pantallas con ese criterio (menos
  elementos, controles y texto a la vista; flujos más directos). Las pruebas verdes no validan esto.
- **Mis pedidos (empleados): los pedidos tienen que estar separados por estado** (secciones o pestañas por
  estado, no una sola lista mezclada). Debe seguir siendo cómodo en celular.
- Al hacerlo: actualizar los E2E y `data-testid` afectados, regenerar capturas y mostrárselas al usuario.

## 1. Correcciones de la revisión (pendientes)

### Seguridad y despliegue (backend)
- **C1 crítico**: producción acepta los secretos de ejemplo. Decisión: `cp .env.example .env && docker compose
  up` sigue andando; el entrypoint genera y persiste en un volumen `SESSION_SECRET` y `ALTCHA_HMAC_KEY` si
  están vacíos o son de ejemplo; portal y `usuario-existe` deshabilitados con valores vacíos/de ejemplo;
  `cargarConfig` rechaza "cambiar…"; `usuarioVigente` exige la familia de sesión.
- **C2 crítico**: `SEED_DEMO=false` por defecto en producción; admin inicial desde `ADMIN_EMAIL` (contraseña
  generada en archivo 0600 si falta); bloquear cuentas demo con la contraseña demo; demo en Docker opcional.
- A1: Personal simulado solo en dev o demo; si no, proveedor nulo (solo usuarios locales).
- A2: `trustProxy: true` permite falsificar la IP detrás de un proxy externo; confiar solo en Caddy.
- A3: validar captcha antes del límite por correo (se puede bloquear cuentas ajenas).
- M1: `NODE_ENV` por defecto `production`; los scripts de desarrollo fijan `development`.
- M4: el outbox descarta eventos tras 10 intentos sin espera; backoff y estado fallido visible.
- Bajos: advertir sin `PORTAL_JWT_AUDIENCE`; revocación por reuso de refresh corta el socket; límites de
  frecuencia en altas/mensajes/adjuntos; orden en `crearTicket` con bloqueo; historial inmutable ante DELETE;
  no mostrar `solicitanteEmail` a compañeros de área; fijar versiones de Metabase/Caddy; healthcheck del
  worker; dependencias sin uso; `docs/OPERACION.md`; `ADJUNTOS_PERMITIDOS` configurable (spec).

### Web (frontend)
- M3: el conflicto de versión se enmascara (`lib/optimista.ts` toma la versión al ejecutar).
- M5: cambios de estado se aplican al mover flechas en el select; pedir confirmación.
- M6: adjuntos fallidos sin reintento.
- Bajos: quitar token de la URL en `/restablecer`; `role="dialog"` sin nombre; atajos `/` y `n`
  desactivables; menú de usuario; quitar `@radix-ui/*`.
- Marca: extraer del brandbook (págs. 8–9) los vectores oficiales de la flor y logotipos (`pdftocairo -svg`).

## 2. Después
Capturas nuevas y revisión visual · tildar `docs/PLAN.md` · pasar decisiones nuevas a `DECISIONES.md` ·
`README.md` · `docs/INFORME_FINAL.md` (aclarar Docker sin probar en vivo; `docker --version` responde en la
máquina pero no se usó; SMTP real sin probar) · verificación desde cero (`node_modules` y `.data` borrados,
`npm install && npm run dev` + `npm test && npm run e2e`).
