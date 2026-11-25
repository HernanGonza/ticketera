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
| 16 | El tiempo en `resuelto` no consume SLA al reabrir; la calificación se borra (queda en el historial) | Contar ese tiempo | El técnico no podía actuar mientras estaba resuelto |
| 17 | `ticket_eventos`: en `reabierto` `de`=`resuelto` y `a`=motivo; en `sla_*` `a`=`respuesta`/`resolucion`; `cerrado_at` también registra cancelación | Columnas extra | Historial simple |
| 18 | Mensajes y calificación no incrementan `version`; reordenar sí | Versionar todo | Evitar conflictos falsos en el kanban |
| 19 | `ambito=mios` = pedidos propios; "mis asignados" usa `asignadoId` | Semántica según rol | Predecible |
| 20 | Vencido/por vencer del tablero usan el SLA de resolución; en espera no cuenta como por vencer | Mezclar ambos SLA | Un solo indicador claro |
| 21 | Cambiar categoría recalcula SLA; cambiar el calendario no recalcula vencimientos ya fijados | Recalcular todo | Compromisos ya asumidos |
| 22 | Códigos por tabla contadora (sin huecos); búsqueda con `pg_trgm` + `unaccent` | Secuencia por año | Correlatividad |
| 23 | Permisos de Metabase aplicados en cada arranque con lista blanca (`docker/permisos-metabase.mjs`) | Script de init con default privileges | Nunca exponer hashes, sesiones ni notas internas |
| 24 | Un usuario bloqueado por un administrador no se reactiva aunque Personal lo informe activo | Personal pisa siempre el estado | Seguridad: el bloqueo local debe persistir |
| 25 | Cada pedido protegido (REST y socket) verifica en la base usuario activo, rol vigente y sesión no revocada | Confiar solo en el JWT corto | Revocación inmediata |
| 26 | Bloqueo local (`usuarios.bloqueado`) separado del estado de Personal; cambiar rol o contraseña revoca sesiones | Un solo campo | Ver decisión 24 |
| 27 | Quien no figura en Personal entra solo si ya tiene usuario local activo; si Personal borra en vez de desactivar, debe desactivarlo un administrador | Bloquear siempre | Cuentas técnicas y caídas de Personal |
| 28 | Refresh de 7 días deslizantes (máximo 30), gracia de 10 s entre pestañas; el reuso revoca la familia | Refresh fijo | Seguridad sin cortes |
| 29 | ALTCHA v1 con desafío de un solo uso; límites de intentos en memoria (una réplica de API) | Almacén compartido | Una sola réplica hoy; anotado como mejora |
| 30 | `/api/auth/config` responde en producción sin accesos de desarrollo; `POST /auth/portal` exento de control de Origin | — | La web lo necesita; el POST llega desde el portal |
| 31 | Diálogos y menús nativos en la web en lugar de Radix | Radix | Peso del paquete inicial |
| 32 | La calificación se ofrece también en pedidos cerrados sin calificar | Solo `resuelto` | El enlace del mail debe funcionar tras el autocierre |
