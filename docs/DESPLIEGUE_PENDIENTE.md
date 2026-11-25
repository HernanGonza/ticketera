# Pendientes para desplegar (anotado el 25/11/2026)

El sistema se probó en local y por ahora funciona bien. Comandos de despliegue en `OPERACION.md`.

## 1. Imprescindible

- [ ] Servidor Linux con Docker Compose v2.
- [ ] Dominio y proxy con certificado (HTTPS) delante del sistema.
- [ ] Llevar el código al servidor: el repositorio no tiene remoto.
- [ ] `.env`: `POSTGRES_PASSWORD` (antes del primer arranque), `APP_URL` con `https://`, `ADMIN_EMAIL`,
      `CADDY_TRUSTED_PROXIES`, `HSTS=max-age=31536000`, `SEED_DEMO` desactivado, `METABASE_DB_PASSWORD`
      (propia o vacía).
- [ ] Primer arranque en un servidor de prueba: Docker nunca se ejecutó.

## 2. Datos a conseguir

| Qué | Sin eso |
|---|---|
| Correo SMTP (servidor, puerto, usuario, clave) | No salen avisos ni funciona el recupero de contraseña |
| Base de Personal (solo lectura; tabla y columnas, ver `apps/api/src/auth/personal/tabla.ts`) | No se crean usuarios desde el portal |
| Portal: claves, `iss` y `aud`; que envíe el token a `/auth/portal` y consulte `/api/sso/usuario-existe` | No se puede ingresar desde el portal |

Se puede empezar sin portal ni Personal: el administrador crea usuarios con contraseña.

## 3. Después del primer arranque

- [ ] Leer la contraseña inicial (`docker compose exec api cat /data/secretos/admin-inicial`), cambiarla y
      borrar el archivo.
- [ ] Revisar áreas, categorías y plazos (los cargados son una propuesta).
- [ ] Cargar feriados y revisar el horario hábil (lunes a viernes, 7 a 19).
- [ ] Crear los técnicos y definir la asignación por categoría (arranca en manual).
- [ ] Probar pedido, adjunto, correo y actualización en vivo entre dos equipos.
- [ ] Programar backups fuera del servidor y probar una restauración.

## Corrección pendiente en la documentación

`OPERACION.md` («HTTP, HTTPS y cookies») y el comentario de `COOKIE_SECURE` en `.env.example` indican que se
puede usar por HTTP en una red interna. **No es así para el ingreso con contraseña:** la verificación ALTCHA usa
Web Crypto, que el navegador solo habilita en HTTPS o `localhost`. Se dedujo del código; no se probó en un
navegador.

## Puede esperar

Control de salud del worker, versión fija de Metabase, vector oficial del texto del logotipo y los pendientes de
`INFORME_FINAL.md`.
