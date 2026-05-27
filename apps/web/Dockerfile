# syntax=docker/dockerfile:1.24
# Multi-stage build for the `apps/web` Next.js shell inside the Bun
# workspaces monorepo. The shell hosts every logical product (menu,
# core, house) via host-based rewrites in src/proxy.ts.
#
# Build context is the REPO ROOT. The image is built + pushed to GHCR by
# `.github/workflows/web.yml`; the running container (`infra-web`) is
# managed by Stage 4 of the deploy pipeline
# (`infra/deploy/cmd/iedora/runtime_docker.go`). Bun installs the
# workspace deps; Node executes the build (Bun + next build is unstable
# per AGENTS.md); final image runs server.js on Node over Next's
# standalone output.
#
# All three stages are glibc (Debian) — no musl→glibc handoff between
# install/build/runtime keeps native-module prebuilts (postgres-js, sharp,
# argon2 …) consistent end-to-end.
#
# Node version is declared once via ARG at the top (Next.js 16 official
# pattern). Bump the ARG value periodically to track the latest LTS.
# Bun base image is pinned by digest — it changes less often.
ARG NODE_VERSION=24.11.0-bookworm-slim

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS deps
WORKDIR /workspace

# Workspace root manifest + lock + shared tsconfig that every per-package
# tsconfig extends. Missing tsconfig.base.json here was the silent regression
# introduced by PR #6 (TypeScript 6 + shared eslint refactor) — every deploy
# after #6 failed with `extends: "../../tsconfig.base.json" doesn't resolve`.
# COPY --link makes each layer independently cacheable — if only bun.lock
# changes, packages/ and products/ don't need to re-COPY.
COPY --link package.json bun.lock tsconfig.base.json ./
# Every workspace referenced from apps/web's package.json must be
# present so `bun install` can resolve workspace:* specifiers:
#   - packages/* → @iedora/{auth,design-system,observability,brand,eslint-config}
#   - products/* → @iedora/product-{menu,core,house}
# Without products/, bun fails fast with:
#   "Workspace dependency @iedora/product-menu not found, Searched in ./*"
COPY --link packages packages
COPY --link products products
COPY --link apps/web/package.json apps/web/package.json

# BuildKit cache mount keeps the Bun global cache warm across rebuilds on
# the same builder host. The cache layer never ships in the image, so it
# is registry-agnostic (works on GHCR, Docker Hub, ECR — all the same).
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --ignore-scripts

# Migration bundle is no longer built here. DOCKER-2 split it into a
# dedicated `ghcr.io/eduvhc/migrate` image (infra/migrate/Dockerfile +
# .github/workflows/migrate.yml) so schema migrations land without
# forcing a Next rebuild. Stage-3 configurators run that image, not
# this one.

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /workspace
# Copy the ENTIRE /workspace from deps — this brings every workspace's
# node_modules tree, including packages/design-system/node_modules where
# `radix-ui` (and other workspace deps' transitives) live as symlinks into
# Bun's .bun store. Copying only root + apps/web/node_modules was a
# bug that worked locally (homelab build context had the host's installed
# node_modules) but failed in CI's clean Docker run.
COPY --from=deps /workspace ./
# Overlay apps/web source (deps only had apps/web/package.json). The
# products/ tree was already brought in by the deps stage above (it has
# real source, not just package.json — workspace:* exports point at
# .ts/.tsx files).
COPY apps/web apps/web

WORKDIR /workspace/apps/web

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# SKIP_ENV_VALIDATION=1 returns a build-time stub Proxy from src/shared/env.ts
# so Next can collect page data without real env. Runtime env is injected
# by the repo-root Tofu container resource (TF-minted OIDC + session secrets).
ENV SKIP_ENV_VALIDATION=1

# Consistent Server Actions encryption key across multi-instance deployments.
# When unset, Next.js generates a random key per build — fine for single-instance
# but breaks Server Actions when instances don't share the same key.
# Pass from CI via --build-arg if running multiple replicas.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}

# Version skew protection — embedded as deploymentId in next.config.ts.
# When the running container's ID differs from the client's, Next.js forces
# a hard navigation instead of client-side navigation, ensuring assets
# always come from a consistent deployment.
ARG DEPLOYMENT_VERSION
ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}

RUN --mount=type=cache,target=/workspace/apps/web/.next/cache,sharing=locked \
    node --run build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Consistent encryption key + deployment version — same values as the
# builder stage. Both are embedded in the standalone output at build
# time; setting them at runtime ensures the running process matches.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}
ARG DEPLOYMENT_VERSION
ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}

# Debian's groupadd/useradd, not Alpine's busybox -S equivalents.
# libjemalloc2 replaces glibc's default malloc — sharp (Next.js image
# optimisation) fragments the default allocator on glibc. The LD_PRELOAD
# env var is read by the dynamic linker at process start, so it applies
# to Node and every child process spawned by server.js.
RUN groupadd --system --gid 1001 nextjs && \
    useradd --system --uid 1001 --gid nextjs --no-create-home --shell /usr/sbin/nologin nextjs && \
    apt-get update && \
    apt-get install -y --no-install-recommends libjemalloc2 && \
    rm -rf /var/lib/apt/lists/*

ENV LD_PRELOAD=/usr/lib/aarch64-linux-gnu/libjemalloc.so.2

# Next standalone in a monorepo lays out under apps/web/. The traced
# node_modules sit at the workspace root inside standalone. server.js is at
# apps/web/server.js — we WORKDIR into it for the CMD.
COPY --from=builder --chown=nextjs:nextjs /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nextjs /workspace/apps/web/public ./apps/web/public

# Next writes prerender + optimized-image caches under .next/cache at first
# request. The standalone copy doesn't create that path; pre-create it
# owned by the runtime user so the very first request doesn't EPERM.
RUN mkdir -p ./apps/web/.next/cache && chown nextjs:nextjs ./apps/web/.next/cache

# Migrations no longer ship in this image. See infra/migrate/Dockerfile
# (and DOCKER-2 in docs/tech-debt.md) — Stage 3 runs the dedicated
# `ghcr.io/eduvhc/migrate` image instead.

USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000

# Caddy on the Hetzner box uses /up as the upstream health probe. /up
# returns 200 from Next as soon as server.js binds the port. Node 24's
# global fetch covers the whole one-liner; no curl needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Links the GHCR package to its source repo automatically. Must match the
# actual repo (`<GHCR_USER>/iedora`) or fine-grained PATs can't push here —
# package-to-repo association is the linking key.
LABEL org.opencontainers.image.source="https://github.com/eduvhc/iedora"

CMD ["node", "server.js"]
