# Informe final — ECOsoporte (25/11/2026)

## Qué se entrega

Sistema completo según `docs/SPEC.md`: ingreso por el portal y de respaldo, pedidos con campos por categoría y
adjuntos, tablero kanban, lista, chat en vivo con notas internas, plazos en horas hábiles, autocierre,
calificación, estadísticas, administración, panel de colas y correos. PostgreSQL es la única infraestructura
(sin Redis ni servicios externos de tiempo real).

Después de la primera versión se simplificó la interfaz a pedido del usuario: «Mis pedidos» en columnas por
estado con el color de cada uno, empleados sin menú lateral, y menos controles a la vista en alta, detalle,
tablero, lista y estadísticas.

## Verificación

En un clon limpio del repositorio, en la máquina de desarrollo (Linux, Node 24):

| Prueba | Resultado |
|---|---|
| `npm install` y `npm run dev` | Arranca; salud, web, ingreso por el portal y tablero responden |
| `npm run typecheck` · `npm run lint` · `npm run build` | Sin errores |
| `npm test` (unitarias e integración) | 390 de 390 |
| `npm run e2e` (incluye accesibilidad) | 85 de 85 |
| Arranque de producción con `.env.example`, fuera de Docker | API y worker arrancan, secretos generados con permisos 0600, sin cuentas de demostración, consulta del portal deshabilitada |

El arranque del clon limpio usó puertos alternativos (los habituales estaban ocupados). La flor oficial y las
capturas se regeneraron en el repositorio.

## Rendimiento

Detalle en `docs/PERFORMANCE.md`. En local se cumplen las metas: JavaScript inicial 117,4 KB (meta 150),
LCP de ingreso 104 ms y de kanban 224 a 260 ms (meta 1,5 s), 60 cuadros por segundo con 576 pedidos y cambios
visibles en otro navegador en 23 a 30 ms (meta 300).

**Con red y procesador limitados** (condición adicional) el kanban queda en el límite o por encima: 1,51 s con
los datos de demostración y 1,86 s con 576 pedidos.

## Revisión de seguridad

Los dos hallazgos críticos (secretos de ejemplo aceptados en producción y cuentas de demostración con
contraseña conocida) están corregidos y cubiertos por pruebas. También se corrigieron los altos y medios, pero
cuatro no tienen una prueba propia: la IP de origen en Caddy (A2), el conflicto de versión (M3), el selector
manejado con flechas (M5) y el reintento de adjuntos (M6). Las decisiones están en `docs/DECISIONES.md`
(39 a 45). La revisión independiente fue anterior a las correcciones: **no hubo una segunda revisión** de ellas
ni de las pantallas simplificadas.

## Lo que no se probó

- **Docker**: ni imágenes ni `docker compose`. Los archivos se revisaron y sus comandos se probaron fuera de
  contenedores; los cambios recientes en Compose, Caddyfile y Dockerfiles no se ejecutaron con Caddy ni Docker.
- **Correo**: ningún servidor SMTP real.
- **Portal del Ministerio**: solo con tokens firmados en las pruebas.
- **Base de Personal**: la tabla y las columnas son supuestas; ajustar `apps/api/src/auth/personal/tabla.ts`.
- **Equipos reales**: celulares, otros navegadores (solo Chromium), lectores de pantalla y carga con muchos
  usuarios a la vez.
- Restauración de backups sobre un despliegue real.

## Pendientes conocidos

- Hallazgos menores sin resolver: el menú de usuario y las dependencias sin uso del backend. El aviso de
  diálogos sin nombre solo se inspeccionó (los vistos lo tienen) y no se cambió nada.
- El worker no tiene control de salud en Compose.
- La imagen de Metabase usa `latest`: conviene fijar una versión (`METABASE_IMAGE`).
- Un evento del outbox que falle siempre se reintenta cada hora y solo se ve en los registros y en la tabla.
- Del manual de marca se incorporó la flor oficial; el texto «ECOLOGÍA MISIONES» sigue compuesto con la
  tipografía, no con el vector del logotipo.

## Antes de ponerlo en producción

1. Primer despliegue en un servidor de prueba siguiendo `docs/OPERACION.md`.
2. Acordar con el portal las claves, `iss` y `aud`, y configurar `PORTAL_JWT_AUDIENCE`.
3. Configurar la base de Personal, el correo y TLS delante del proxy.
4. Programar los backups y probar una restauración.
