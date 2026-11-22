# syntax=docker/dockerfile:1
# PROMANGO API — صورة إنتاج متعددة المراحل. لا أسرار داخل الصورة: كلها من متغيرات البيئة وقت التشغيل.
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
# مستخدم غير جذري يملك مجلد المرفقات فقط.
RUN groupadd --system app && useradd --system --gid app --home /app app \
 && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# الـ migrations تُطبَّق قبل الإقلاع في كل نشر (آمنة: لا تعيد ما طُبّق).
CMD ["sh", "-c", "node dist/database/migrate.js run && exec node dist/main.js"]
