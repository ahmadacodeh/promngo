# syntax=docker/dockerfile:1
# PROMANGO Web — بناء Vite ثم تقديم الملفات الساكنة عبر Caddy (TLS تلقائي + تمرير /api إلى الخادم).
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2.8.4-alpine AS runtime
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
