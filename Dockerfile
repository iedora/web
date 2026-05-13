# syntax=docker/dockerfile:1.7
# Multi-stage build para Next.js 16 em produção.
# Bun instala dependências (rápido); Node executa o build (AGENTS.md: Bun + next build
# é instável); imagem final usa Node sobre o output `standalone` do Next.

# ── Stage 1: dependências ─────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Dummies para a fase "collect page data" do Next 16 — vários módulos validam env
# vars no carregamento (lib/db, auth, redis, …) e falhariam o build sem isto.
# Os valores reais vêm da config Kamal em runtime.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV REDIS_URL=redis://localhost:6379
ENV BETTER_AUTH_SECRET=build-time-placeholder
ENV BETTER_AUTH_URL=http://localhost:3000
ENV S3_ENDPOINT=http://localhost:4566
ENV S3_REGION=us-east-1
ENV S3_ACCESS_KEY=build
ENV S3_SECRET_KEY=build
ENV S3_BUCKET=build

RUN node --run build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nextjs && \
    adduser -S -u 1001 -G nextjs nextjs

# Standalone output inclui server.js + dependências mínimas
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

# Migrations: script standalone + ficheiros SQL gerados pelo drizzle-kit.
# O Next inlina drizzle-orm/postgres dentro do server.js, mas o migrate.mjs é um
# executável separado, por isso copiamos os pacotes explicitamente.
COPY --from=builder --chown=nextjs:nextjs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nextjs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nextjs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nextjs /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
