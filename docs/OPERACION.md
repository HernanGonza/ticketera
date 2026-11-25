# Operación

> El despliegue con Docker se revisó estáticamente y sus comandos internos se probaron fuera de
> contenedores; no se ejecutó Docker durante el desarrollo. Verifique el primer arranque en el servidor.

## Despliegue

Requisitos: Docker con Compose v2.

```
cp .env.example .env
docker compose up -d --build
```

Sin editar nada arranca una instalación **sin datos de demostración**, en <http://localhost:8080>:

- `SESSION_SECRET` y `ALTCHA_HMAC_KEY` se generan solos y quedan en el volumen `secretos`.
- Se crea el administrador de `ADMIN_EMAIL` con una contraseña generada. Para leerla:
  `docker compose exec api cat /data/secretos/admin-inicial`. Cámbiela y borre ese archivo.
- El ingreso desde el portal queda deshabilitado hasta definir sus claves.

Para una **demo** con usuarios de prueba (contraseña pública, solo para evaluar), ponga `SEED_DEMO=true`
antes del primer arranque. Si una base con datos de demostración pasa a producción, la contraseña de
demostración deja de aceptarse, pero conviene empezar con una base limpia.

### Antes de usarlo en producción (en `.env`)

| Variable | Qué poner |
|---|---|
| `POSTGRES_PASSWORD` | Clave aleatoria (solo letras, números, `-` y `_`). Se fija en el primer arranque |
| `PORTAL_JWT_SECRET` (o clave pública / JWKS), `PORTAL_API_KEY`, `PORTAL_URL` | Las acordadas con el portal |
| `APP_URL` | Dirección exacta con la que los usuarios abren el sistema |
| `ADMIN_EMAIL` | Correo del administrador inicial (`ADMIN_PASSWORD` es opcional) |
| `SMTP_*`, `MAIL_FROM` | Servidor de correo |
| `PERSONAL_DATABASE_URL` | Base de Personal (solo lectura). Sin ella solo ingresan los usuarios locales |
| `METABASE_DB_PASSWORD` | Clave aleatoria, o vacía si no se usará Metabase |
| `SESSION_SECRET`, `ALTCHA_HMAC_KEY` | Opcionales: 32+ caracteres si prefiere definirlas usted |

Los valores de ejemplo son públicos y el sistema no los usa como secretos.
Cadenas aleatorias: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Para cambiar `POSTGRES_PASSWORD` con la base ya creada, cámbiela primero en Postgres
(`docker compose exec db psql -U ecosoporte`, comando `\password`) y luego en `.env`.

### HTTP, HTTPS y cookies

- El compose publica HTTP en `APP_PORT`. En producción ponga delante un proxy con TLS, use
  `APP_URL=https://…`, `HSTS=max-age=31536000` y `CADDY_TRUSTED_PROXIES` con la IP de ese proxy.
- Las cookies son `Secure` por defecto. Chrome y Firefox las aceptan en `http://localhost`, pero no al
  entrar por IP o nombre de red con HTTP plano: el ingreso parece funcionar y vuelve a `/login`. Para
  una red interna sin TLS: `APP_URL=http://192.168.0.10:8080` y `COOKIE_SECURE=false`.
- Si `APP_URL` no coincide con la dirección del navegador, la API rechaza las modificaciones.

### Servicios

`proxy` (Caddy: web, `/api`, `/auth/portal`, `/socket.io`; `/dev` bloqueado), `api` (al arrancar migra,
carga datos iniciales y actualiza permisos), `worker` (misma imagen: mails, SLA, autocierre,
asignación), `db` (PostgreSQL 16). Solo el proxy publica un puerto a la red.

Volúmenes: `pgdata` (base) y `uploads` (adjuntos). `docker compose down -v` **los borra**.

En producción sin `SMTP_HOST` los correos no se envían ni se guardan: solo queda una advertencia en los
registros del worker (llevan enlaces con credenciales).

### Uso diario

```
docker compose ps
docker compose logs -f --tail=100
git pull && docker compose up -d --build     # actualizar (haga antes un backup)
```

Los registros del proxy ocultan `token` y `email` de las URL y no incluyen encabezados.

## Metabase (perfil `stats`)

```
docker compose --profile stats up -d
```

Es la única excepción a "solo el proxy publica puertos": escucha en `127.0.0.1:3030` del servidor
(`METABASE_PORT`). Desde otro equipo: `ssh -L 3030:127.0.0.1:3030 usuario@servidor` y abrir
<http://localhost:3030>. Cree el usuario administrador de Metabase apenas lo levante.

Al conectar la base en Metabase: PostgreSQL, host `db`, puerto `5432`, base `ecosoporte`, usuario
`metabase_ro`, clave `METABASE_DB_PASSWORD`.

El usuario `metabase_ro` lo crea y actualiza la API en cada arranque
(`docker/permisos-metabase.mjs`). Es de solo lectura y solo ve:

- tablas `areas`, `categorias`, `tickets`, `ticket_eventos`;
- las vistas de estadísticas (prefijo `v_`);
- de `usuarios`, las columnas `id, email, nombre, area_id, rol, activo, ultimo_acceso, creado_at`
  (en Metabase use preguntas con columnas explícitas: `select *` sobre `usuarios` se rechaza).

No accede a contraseñas, sesiones, tokens, mensajes, adjuntos, notificaciones ni colas. Una vista `v_`
nueva queda visible para Metabase: no incluya en ellas datos sensibles. Tras cambiar la clave en
`.env`, ejecute `docker compose up -d`. La configuración propia de Metabase se guarda en el volumen
`metabase-data`.

## Backups

```
npm run backup-db -- --compose
```

Genera en `./backups` la base (`ecosoporte-AAAAMMDD-HHmmss.dump`, formato *custom* de `pg_dump`) y los
adjuntos (`adjuntos-….tar.gz`). Requiere Node 22+ y `npm install` en el servidor. Sin Node:

```
docker compose exec -T db pg_dump -U ecosoporte -d ecosoporte --format=custom --file=/tmp/eco.dump
docker compose cp db:/tmp/eco.dump ./eco.dump
docker compose exec -T api tar -czf /tmp/adjuntos.tar.gz -C /data/uploads .
docker compose cp api:/tmp/adjuntos.tar.gz ./adjuntos.tar.gz
```

Otros orígenes: `npm run backup-db -- --url=postgres://usuario:clave@host:5432/base` y
`npm run backup-db -- --embebido` (desarrollo). Ambos necesitan `pg_dump` 16 o posterior instalado
(el Postgres embebido no lo trae); la ruta puede indicarse en `PG_DUMP`.

Guarde las copias fuera del servidor, junto con el `.env`, y pruebe la restauración periódicamente.
Para programarlo, ejecute el comando desde `cron` o el Programador de tareas.

## Restauración

Reemplaza el contenido actual. Con la API y el worker detenidos:

```
docker compose stop proxy worker api
docker compose cp ./backups/ecosoporte-FECHA.dump db:/tmp/eco.dump
docker compose exec -T db dropdb -U ecosoporte --force ecosoporte
docker compose exec -T db createdb -U ecosoporte ecosoporte
docker compose exec -T db pg_restore -U ecosoporte -d ecosoporte --no-owner --no-privileges --exit-on-error /tmp/eco.dump
docker compose up -d
```

Adjuntos (se copian dentro del volumen `uploads`):

```
docker compose cp ./backups/adjuntos-FECHA.tar.gz api:/tmp/adjuntos.tar.gz
docker compose exec -T api tar -xzf /tmp/adjuntos.tar.gz -C /data/uploads
```

En un servidor nuevo, `metabase_ro` se vuelve a crear solo al arrancar la API.

Si la copia se hizo con un `pg_dump` más nuevo que el servidor (p. ej. `--embebido` con cliente 17 o
posterior), quite `--exit-on-error`: el único error esperable es el parámetro desconocido
`transaction_timeout`, que no afecta los datos.
