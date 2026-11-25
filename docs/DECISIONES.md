# Decisiones (ADR breves)

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| 1 | Se trabaja con la última versión del pedido (npm, Postgres embebido, pg-boss, sin Redis, Ingreso Único detallado) | Versiones anteriores (pnpm, Redis, BullMQ) | Indicación del usuario |
| 2 | No se ejecuta Docker aunque `docker --version` responde en la máquina | Probar el compose | Restricción explícita del pedido |
| 3 | Brandbook movido de la raíz a `docs/marca/` | Dejarlo en la raíz | Es la ruta que fija la especificación |
| 4 | Oak Sans (variable, licencia SIL OFL) tomada de la Wiki del Ministerio y servida desde la app | Fallback Inter | Fuente oficial disponible y libre |
| 5 | SLA en minutos del horario hábil (default lun–vie 07:00–19:00, configurable) | Tiempo corrido | Un pedido del viernes a la tarde no debe vencer el sábado |
| 6 | "72 h hábiles" = 72 horas contando solo días hábiles (≈ 3 días) | 72 horas de horario hábil (≈ 6 días) | Uso habitual de la expresión; configurable en horas |
| 7 | UTC-3 fijo en el cálculo hábil | Librería de zonas horarias | Argentina no aplica horario de verano; menos peso |
| 8 | Efectos colaterales (mails, notificaciones, asignación, sockets) salen del outbox en el worker; la API solo escribe | Encolar desde la API | Atomicidad y un solo camino |
| 9 | La lógica de mutación de tickets vive en `apps/api/src/db` y la comparten API y worker | Duplicarla | Autocierre y asignación automática deben respetar las mismas reglas |
| 10 | Sala extra `ticket:{id}:interno` solo para staff | Filtrar en el cliente | Las notas internas nunca deben viajar a solicitantes |
| 11 | El token de recupero de contraseña lo genera el worker al enviar el mail | Generarlo en la API y pasarlo por la cola | Nunca queda en claro en la base |
| 12 | `cancelado` no tiene columna en el kanban; `cerrado` muestra los últimos 7 días | Mostrar todo | Tablero liviano |
| 13 | `TypeScript ~5.9`, TanStack Table 8 | TypeScript 7 / Table 9 | Compatibilidad con el ecosistema (lint, tipos) |
| 14 | `allowScripts` en `package.json` y `autoRehydrateSymlinks` | Pasos manuales | npm recientes bloquean los scripts de instalación que necesita Postgres embebido |
| 15 | Reabrir: con técnico asignado vuelve a `en_curso`, sin técnico a `nuevo` | Siempre `en_curso` | `en_curso` exige responsable |
