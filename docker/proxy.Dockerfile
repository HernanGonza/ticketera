# Proxy público: Caddy con el build de la web. Contexto: raíz del repositorio.
FROM node:22-alpine AS construccion
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_audit=false npm_config_fund=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci -w @eco/web -w @eco/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @eco/web

FROM caddy:2.10-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=construccion /app/apps/web/dist /srv
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
