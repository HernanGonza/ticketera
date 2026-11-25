# Rendimiento

Medido el 25/11/2026 con `npm run e2e:perf` (`tests/e2e/perf/rendimiento.spec.ts`). Cada corrida deja los
números completos en `test-results/rendimiento-*.json`.

## Resumen

| Meta | Resultado | Estado |
|---|---|---|
| JavaScript inicial < 150 KB gzip | 117,4 KB (CSS inicial 8,3 KB) | Cumple |
| LCP de `/login` < 1,5 s | 88 ms (mediana) | Cumple en local |
| LCP del kanban < 1,5 s | 208 ms con datos de demostración; 224 ms con 576 pedidos abiertos | Cumple en local |
| Arrastre fluido con 500 pedidos | 60 cuadros/s, peor cuadro 17 ms | Cumple (ver limitaciones) |
| Mutación en A visible en B < 300 ms | mediana 22 a 28 ms, p95 26 a 39 ms | Cumple en local |

Con red y procesador limitados (condición adicional, no exigida) el kanban con 576 pedidos supera los
1,5 s: ver la tabla de carga.

## Método

- Equipo: AMD Ryzen 3 7330U (8 hilos), 6 GB de RAM, Linux, Node 24, Chromium sin interfaz de Playwright.
- Todo en la misma máquina: Postgres embebido, API y worker compilados (`dist/`) y web compilada
  (`vite build`) servida por `vite preview`. El stack lo levanta `node scripts/dev.mjs --build`, con datos
  de demostración recién cargados. La API corre con `NODE_ENV=development`.
- **JavaScript inicial**: `apps/web/scripts/medir-bundle.mjs` suma el gzip (nivel 9) de los scripts y
  `modulepreload` de `index.html`. El total por pantalla suma, con la misma compresión, todos los `.js`
  pedidos al abrirla en frío.
- **Carga**: 7 aperturas por caso, cada una en un contexto de navegador nuevo (sin caché). LCP según
  `PerformanceObserver`; "contenido" es el primer cuadro con el elemento útil en el DOM (verificación
  anti-robots en el ingreso, primera tarjeta en el kanban). "Limitada": 10 Mb/s de bajada, 5 de subida,
  40 ms de latencia y procesador 4 veces más lento (emulación de DevTools).
- **500 pedidos**: `db/cli.ts perf 500` agrega 500 pedidos abiertos a la demostración (576 en el tablero).
- **Arrastre**: 6 segundos moviendo una tarjeta con el puntero de punta a punta del tablero (1920 × 1000),
  contando intervalos de `requestAnimationFrame`. Se repite con el procesador 4 veces más lento.
- **Latencia entre navegadores**: dos sesiones distintas. El reloj corre desde el evento del usuario en A
  (tecla Enter, cambio del selector o soltado del puntero) hasta que el cambio aparece en el DOM de B.
  Recorre API, transacción con outbox, publicador del worker, adaptador de Postgres y Socket.IO.

## Carga

Milisegundos, mediana / p95 de 7 muestras.

| Caso | Red local: LCP | Red local: contenido | Limitada: LCP | Limitada: contenido |
|---|---|---|---|---|
| Ingreso | 88 / 92 | 105 / 118 | 516 / 520 | 553 / 564 |
| Kanban, demostración | 208 / 216 | 198 / 209 | 1468 / **1512** | 1485 / 1529 |
| Kanban, 576 pedidos | 224 / 240 | 220 / 237 | **1780 / 1820** | 1783 / 1823 |

La respuesta de `GET /api/kanban` con 576 pedidos pesa unos 500 KB sin comprimir y `vite preview` no
comprime lo que reenvía a la API. En producción Caddy sí la comprime: la misma medición contra el stack de
producción detrás de Caddy 2.11.9 (fuera de Docker) dio un LCP limitado de **1516 ms** (p95 1544 ms) con
576 pedidos y 1436 ms con la demostración; en red local, 256 ms y 240 ms. Es decir, en esas condiciones el
tablero queda en el borde de la meta. Si hiciera falta margen, las opciones son pedir menos tickets
resueltos al tablero, paginar columnas o adelantar la descarga del fragmento del kanban.

## Latencia entre navegadores

| Mutación | Muestras | Mediana | p95 | Máximo |
|---|---|---|---|---|
| Mensaje de chat | 30 | 28 ms | 39 ms | 43 ms |
| Cambio de estado | 30 | 22 ms | 26 ms | 27 ms |
| Arrastre en el tablero | 20 | 25 ms | 29 ms | 35 ms |

Detrás de Caddy los valores fueron equivalentes (p95 entre 31 y 44 ms).

## Arrastre con 576 pedidos

| Procesador | Cuadros/s | Mediana | p95 | Peor | Hilo principal ocupado | Movimientos procesados |
|---|---|---|---|---|---|---|
| Normal | 60 | 16,7 ms | 17 ms | 17 ms | 32 % | 360 |
| 4 veces más lento | 60 | 16,7 ms | 17 ms | 17 ms | 77 % | 254 |

Las columnas están virtualizadas: hay 48 tarjetas en el DOM de las 576.

## JavaScript por pantalla

Total descargado al abrir cada pantalla en frío (incluye el inicial), KB gzip.

| Pantalla | KB | Pantalla | KB |
|---|---|---|---|
| No habilitado, restablecer | 125,1 | Lista | 165,6 |
| Recuperar contraseña | 146,8 | Administración: categorías | 173,2 |
| Ingreso | 147,9 | Kanban | 183,4 |
| Administración: áreas, configuración, colas, usuarios | 150,3 a 151,4 | Nuevo pedido | 192,2 |
| Mis pedidos | 153,0 | Detalle de pedido | 210,8 |
| | | Estadísticas (ECharts) | 343,9 |

La meta de 150 KB se refiere al paquete inicial; el resto se carga por pantalla.

## Limitaciones

- Navegador, servidor y base comparten la máquina y la red es la interfaz local: no hay latencia real ni
  usuarios concurrentes. No es una prueba de carga.
- Chromium sin interfaz no usa la GPU ni la frecuencia de una pantalla real: marca cuadros a 60 Hz. Los
  intervalos revelan bloqueos del hilo principal, pero no el costo de pintado en un equipo concreto.
  Conviene repetir el arrastre a mano en una PC representativa del Ministerio.
- La emulación limitada no afecta del mismo modo a WebSocket ni a los workers.
- Los valores varían unas decenas de milisegundos entre corridas.
- No se probó dentro de contenedores.
