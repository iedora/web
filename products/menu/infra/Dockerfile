# syntax=docker/dockerfile:1.24
# Multi-stage build for the menu app inside the Bun workspaces monorepo.
#
# Build context is the REPO ROOT (set via deploy.yml's `builder.context:
# ../../..`). Bun installs the workspace deps; Node executes the build
# (Bun + next build is unstable per AGENTS.md); final image runs server.js
# on Node over Next's standalone output.
#
# All three stages are glibc (Debian) — no musl→glibc handoff between
# install/build/runtime keeps native-module prebuilts (postgres-js, sharp,
# argon2 …) consistent end-to-end. Base images pinned by digest so the
# image is reproducible until we explicitly bump.

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS deps
WORKDIR /workspace

# Workspace root manifest + lock.
COPY package.json bun.lock ./
# Every workspace package referenced from menu's package.json must be
# present so `bun install` can resolve `"@iedora/design-system": "workspace:*"`.
COPY packages packages
COPY products/menu/package.json products/menu/package.json
# Empty stubs so the workspace globs still match (no need to ship genkan/
# house source into menu's image).
RUN mkdir -p products/genkan products/house
COPY products/genkan/package.json products/genkan/package.json
COPY products/house/package.json products/house/package.json

# BuildKit cache mount keeps the Bun global cache warm across rebuilds on
# the same builder host. The cache layer never ships in the image, so it
# is registry-agnostic (works on GHCR, Docker Hub, ECR — all the same).
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --ignore-scripts

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:689c11043dad91472750cd824c97dd5e2318e9dd6f954e492fe7af0135d33ceb AS builder
WORKDIR /workspace
# Copy the ENTIRE /workspace from deps — this brings every workspace's
# node_modules tree, including packages/design-system/node_modules where
# `radix-ui` (and other workspace deps' transitives) live as symlinks into
# Bun's .bun store. Copying only root + products/menu/node_modules was a
# bug that worked locally (homelab build context had the host's installed
# node_modules) but failed in CI's clean Docker run.
COPY --from=deps /workspace ./
# Overlay menu source (deps only had products/menu/package.json).
COPY products/menu products/menu

WORKDIR /workspace/products/menu

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# SKIP_ENV_VALIDATION=1 returns a build-time stub Proxy from src/shared/env.ts
# so Next can collect page data without real env. Runtime env comes via Kamal.
ENV SKIP_ENV_VALIDATION=1

# Better Auth reads process.env at module load — placeholders so build is quiet.
ENV BETTER_AUTH_SECRET=build-placeholder-overridden-at-runtime-32chars
ENV BETTER_AUTH_URL=http://build.local

RUN node --run build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:689c11043dad91472750cd824c97dd5e2318e9dd6f954e492fe7af0135d33ceb AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Debian's groupadd/useradd, not Alpine's busybox -S equivalents.
RUN groupadd --system --gid 1001 nextjs && \
    useradd --system --uid 1001 --gid nextjs --no-create-home --shell /usr/sbin/nologin nextjs

# Next standalone in a monorepo lays out under products/menu/. The traced
# node_modules sit at the workspace root inside standalone. server.js is at
# products/menu/server.js — we WORKDIR into it for the CMD.
COPY --from=builder --chown=nextjs:nextjs /workspace/products/menu/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /workspace/products/menu/.next/static ./products/menu/.next/static
COPY --from=builder --chown=nextjs:nextjs /workspace/products/menu/public ./products/menu/public

# Next writes prerender + optimized-image caches under .next/cache at first
# request. The standalone copy doesn't create that path; pre-create it
# owned by the runtime user so the very first request doesn't EPERM.
RUN mkdir -p ./products/menu/.next/cache && chown nextjs:nextjs ./products/menu/.next/cache

USER nextjs
WORKDIR /app/products/menu
EXPOSE 3000

# Kamal uses this as the rolling-deploy gate. /up returns 200 from Next
# as soon as server.js binds the port. Node 22's global fetch covers the
# whole one-liner; no curl needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Links the GHCR package to its source repo automatically. Must match the
# actual repo (`<GHCR_USER>/iedora`) or fine-grained PATs can't push here —
# package-to-repo association is the linking key.
LABEL org.opencontainers.image.source="https://github.com/eduvhc/iedora"

CMD ["node", "server.js"]
