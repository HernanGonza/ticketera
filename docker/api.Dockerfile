# Imagen única de la API y el worker (el compose elige el comando). Contexto: raíz del repositorio.
FROM node:22-alpine AS base
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_audit=false npm_config_fund=false

# Solo los manifiestos: la capa de dependencias se reutiliza mientras no cambien.
FROM base AS manifiestos
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

FROM manifiestos AS construccion
RUN npm ci
COPY tsconfig.base.json ./
COPY scripts/bundle.mjs scripts/
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN npm run build -w @eco/api && npm run build -w @eco/worker

# Solo dependencias de producción de api y worker (sin la web ni herramientas de desarrollo).
FROM manifiestos AS dependencias
RUN npm ci --omit=dev -w @eco/api -w @eco/worker && npm cache clean --force

FROM base AS ejecucion
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    DATA_DIR=/data \
    UPLOADS_DIR=/data/uploads
COPY --from=dependencias /app ./
COPY --from=construccion /app/apps/api/dist apps/api/dist
COPY --from=construccion /app/apps/worker/dist apps/worker/dist
# El código empaquetado lee las migraciones SQL del árbol de fuentes.
COPY apps/api/src/db/migrations apps/api/src/db/migrations
COPY docker/entrypoint.mjs docker/permisos-metabase.mjs docker/
# Un volumen nuevo montado en /data/uploads hereda este propietario.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "docker/entrypoint.mjs"]
