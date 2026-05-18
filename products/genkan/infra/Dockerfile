# syntax=docker/dockerfile:1.24
# Multi-stage build for genkan inside the Bun workspaces monorepo.
# Build context is the REPO ROOT (set via deploy.yml's `builder.context:
# ../../../..`). Same pattern as products/menu/infra/Dockerfile.
#
# All three stages are glibc (Debian) — no musl→glibc handoff between
# install/build/runtime keeps native-module prebuilts (postgres-js,
# argon2 …) consistent end-to-end. Base images pinned by digest.

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS deps
WORKDIR /workspace

COPY package.json bun.lock ./
COPY packages packages
COPY products/genkan/package.json products/genkan/package.json
# Stubs so the workspace globs still resolve without shipping sibling source.
RUN mkdir -p products/menu products/house
COPY products/menu/package.json products/menu/package.json
COPY products/house/package.json products/house/package.json

# BuildKit cache mount keeps the Bun global cache warm across rebuilds on
# the same builder host. The cache layer never ships.
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --ignore-scripts

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:689c11043dad91472750cd824c97dd5e2318e9dd6f954e492fe7af0135d33ceb AS builder
WORKDIR /workspace
# Copy the ENTIRE /workspace from deps — see menu's Dockerfile for the
# rationale. Workspace package node_modules must come over too.
COPY --from=deps /workspace ./
COPY products/genkan products/genkan

WORKDIR /workspace/products/genkan

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1
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

# Next standalone in a monorepo lays out under products/genkan/.
COPY --from=builder --chown=nextjs:nextjs /workspace/products/genkan/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /workspace/products/genkan/.next/static ./products/genkan/.next/static
# Genkan has no public/ directory — auth pages render entirely from the
# design system. Skip the copy that menu's Dockerfile does.

# Next writes prerender caches under .next/cache at first request.
# Pre-create the path owned by the runtime user so the first request
# doesn't EPERM (image optimisation is unused here, but the path is
# still touched by Next's RSC cache machinery).
RUN mkdir -p ./products/genkan/.next/cache && chown nextjs:nextjs ./products/genkan/.next/cache

USER nextjs
WORKDIR /app/products/genkan
EXPOSE 3000

# Kamal uses this as the rolling-deploy gate. /up returns 200 from Next
# as soon as server.js binds the port. Node 22's global fetch covers the
# whole one-liner; no curl needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Links the GHCR package to its source repo automatically. Must match the
# actual repo (`<GHCR_USER>/iedora`) — same rationale as menu's Dockerfile.
LABEL org.opencontainers.image.source="https://github.com/eduvhc/iedora"

CMD ["node", "server.js"]
