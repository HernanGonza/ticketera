# Rendimiento

Medido el 25/11/2026 con `npm run e2e:perf` (`tests/e2e/perf/rendimiento.spec.ts`). Cada corrida deja los
números completos en `test-results/rendimiento-*.json`.

## Resumen

| Meta | Resultado | Estado |
|---|---|---|
| JavaScript inicial < 150 KB gzip | 117,4 KB (CSS inicial 8,4 KB) | Cumple |
| LCP de `/login` < 1,5 s | 104 ms (mediana) | Cumple en local |
| LCP del kanban < 1,5 s | 224 ms con datos de demostración; 260 ms con 576 pedidos abiertos | Cumple en local |
| Arrastre fluido con 500 pedidos | 60 cuadros/s, peor cuadro 17 ms (33 ms con procesador 4 veces más lento) | Cumple (ver limitaciones) |
| Mutación en A visible en B < 300 ms | mediana 23 a 30 ms, p95 32 a 50 ms | Cumple en local |

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
| Ingreso | 104 / 116 | 119 / 127 | 580 / 628 | 594 / 650 |
| Kanban, demostración | 224 / 256 | 211 / 245 | **1512 / 1728** | 1527 / 1753 |
| Kanban, 576 pedidos | 260 / 364 | 252 / 358 | **1864 / 1948** | 1864 / 1947 |

La medición detrás de Caddy que sigue es anterior a la simplificación de pantallas.

La respuesta de `GET /api/kanban` con 576 pedidos pesa unos 500 KB sin comprimir y `vite preview` no
comprime lo que reenvía a la API. En producción Caddy sí la comprime: la misma medición contra el stack de
producción detrás de Caddy 2.11.9 (fuera de Docker) dio un LCP limitado de **1516 ms** (p95 1544 ms) con
576 pedidos y 1436 ms con la demostración; en red local, 256 ms y 240 ms. Es decir, en esas condiciones el
tablero queda en el borde de la meta. Si hiciera falta margen, las opciones son pedir menos tickets
resueltos al tablero, paginar columnas o adelantar la descarga del fragmento del kanban.

## Latencia entre navegadores

| Mutación | Muestras | Mediana | p95 | Máximo |
|---|---|---|---|---|
| Mensaje de chat | 30 | 30 ms | 36 ms | 67 ms |
| Cambio de estado | 30 | 23 ms | 32 ms | 82 ms |
| Arrastre en el tablero | 20 | 27 ms | 50 ms | 58 ms |

En la medición anterior detrás de Caddy los valores fueron equivalentes (p95 entre 31 y 44 ms).

## Arrastre con 576 pedidos

| Procesador | Cuadros/s | Mediana | p95 | Peor | Hilo principal ocupado | Movimientos procesados |
|---|---|---|---|---|---|---|
| Normal | 60 | 16,7 ms | 17 ms | 17 ms | 34 % | 359 |
| 4 veces más lento | 59,5 | 16,7 ms | 17 ms | 33 ms | 77 % | 217 |

Las columnas están virtualizadas: hay 54 tarjetas en el DOM de las 576.

## JavaScript por pantalla

Total descargado al abrir cada pantalla en frío (incluye el inicial), KB gzip.

| Pantalla | KB | Pantalla | KB |
|---|---|---|---|
| No habilitado, restablecer | 124,8 | Lista | 166,2 |
| Recuperar contraseña | 146,5 | Administración: categorías | 173,4 |
| Ingreso | 147,6 | Kanban | 181,6 |
| Administración: áreas, configuración, colas, usuarios | 150,4 a 151,5 | Nuevo pedido | 192,3 |
| Mis pedidos | 155,2 | Detalle de pedido | 211,2 |
| | | Estadísticas (ECharts) | 344,1 |

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
