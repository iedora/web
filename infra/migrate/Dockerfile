# syntax=docker/dockerfile:1.24
# `ghcr.io/eduvhc/migrate` — one-shot DB-migration runtime.
#
# Why a separate image (not piggybacking apps/web's Next image):
# schema migrations land much more often than Next app code. Coupling
# them to Next's build cycle forces a ~10min Next rebuild for a
# 1-keyword SQL fix (see DOCKER-2 in docs/tech-debt.md). This image
# decouples migrate cadence from web cadence.
#
# Pattern references:
# - altan.fyi — Drizzle migrations in a monorepo (bundle-and-ship)
# - Chainguard / distroless — ~50MB runtime, no shell, smaller attack
#   surface than the full node image
# - andrewlock.net — Kubernetes job pattern for one-shot migrators
#   (same docker-run-rm shape we use in Stage 3)
#
# Build context: REPO ROOT. The bundler stage reads packages/auth +
# products/menu source; the runtime stage carries ONLY the bundles
# + their drizzle/ folders. No node_modules, no shell, no leftover
# build tools.

# ── Stage 1: bundle migrate scripts ───────────────────────────────────────────
# bun installs first so workspace:* deps resolve when bun build walks
# the import graph. The bundler inlines drizzle-orm + postgres-js +
# their transitive deps into a single self-contained ESM file per
# script (~193 KB each).
FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS bundler
WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY packages packages
COPY products products
# bun.lock includes every workspace member's deps. apps/web is in the
# workspaces array (root package.json); without its package.json,
# `bun install --frozen-lockfile` sees a mismatch ("lockfile had
# changes, but lockfile is frozen") because it can't reconcile the
# lockfile's apps/web entry with a missing manifest. We only need
# the package.json — apps/web's source code is irrelevant to the
# migrate bundle.
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --ignore-scripts
RUN mkdir -p /out/core/scripts /out/core/drizzle \
             /out/menu/scripts /out/menu/drizzle \
             /out/imopush/scripts /out/imopush/drizzle && \
    bun build packages/auth/scripts/migrate.mjs \
        --target=node --format=esm \
        --outfile=/out/core/scripts/migrate.mjs && \
    bun build products/menu/scripts/migrate.mjs \
        --target=node --format=esm \
        --outfile=/out/menu/scripts/migrate.mjs && \
    bun build products/imopush/scripts/migrate.mjs \
        --target=node --format=esm \
        --outfile=/out/imopush/scripts/migrate.mjs && \
    cp -r packages/auth/drizzle/. /out/core/drizzle/ && \
    cp -r products/menu/drizzle/. /out/menu/drizzle/ && \
    cp -r products/imopush/drizzle/. /out/imopush/drizzle/

# ── Stage 2: distroless runtime ───────────────────────────────────────────────
# gcr.io/distroless/nodejs24-debian12 — Google's distroless image.
# Contains: glibc, libssl, node 24, ca-certificates, tzdata. No
# shell, no apt, no busybox. Runs as nonroot uid 65532 by default.
#
# Layout matches Stage-3 configurators' invocation:
#   /migrate/core/scripts/migrate.mjs     (CORE_DATABASE_URL env)
#   /migrate/core/drizzle/                (auth's sql + meta/_journal.json)
#   /migrate/menu/scripts/migrate.mjs     (MENU_DATABASE_URL env)
#   /migrate/menu/drizzle/                (menu's sql + meta/_journal.json)
#   /migrate/imopush/scripts/migrate.mjs  (IMOPUSH_DATABASE_URL env)
#   /migrate/imopush/drizzle/             (imopush's sql + meta/_journal.json)
#
# Stage 3 invokes (one docker run per product):
#   docker run --rm -e CORE_DATABASE_URL=... <image> \
#     /migrate/core/scripts/migrate.mjs
#
# `iedora local migrate` invokes the same image with the same layout
# against the dev infra-postgres container (joined to the `iedora`
# docker network). See infra/deploy/cmd/iedora/local_migrate.go.
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /migrate
COPY --from=bundler --chown=nonroot:nonroot /out/ /migrate/

# Default ENTRYPOINT is `/nodejs/bin/node` per the distroless image.
# Stage 3 passes the script path as CMD args at `docker run` time.
# CMD here is just a safe default (running it without args is a no-op
# since the script needs CORE_DATABASE_URL / MENU_DATABASE_URL).
CMD ["/migrate/core/scripts/migrate.mjs"]

LABEL org.opencontainers.image.source="https://github.com/eduvhc/iedora"
LABEL org.opencontainers.image.title="iedora-migrate"
LABEL org.opencontainers.image.description="Distroless one-shot DB migrator for iedora (Drizzle bundles + sql)."
