<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> Bun-workspaces monorepo. One Next.js product (`apps/web/`)
> serving `menu.iedora.com` (menu app), `core.iedora.com` (auth/sign-in),
> and `iedora.com` (house landing) through a Host-based rewrite in
> `src/proxy.ts`, plus workspace packages (`packages/auth/`,
> `packages/design-system/`, `packages/iedora-observability/`).
> `bun install` runs ONCE at the repo root and resolves every workspace.
>
> Deploy: **Kamal** + **`home-infra/`**.
> CI pipeline legada (Go + Tofu) ainda existe nos workflows mas foi
> removida do disco. Ver `docs/deploy/README.md` e `docs/tech-debt.md`.

## What this is

- **Menu** (menu.iedora.com — `apps/web/`) — SaaS multi-tenant restaurant menu builder.
- **Core** (core.iedora.com — `apps/web/`) — better-auth sign-in surface. Served by the same Next.js process; `src/proxy.ts` routes `/core/*` paths.
- **House** (iedora.com — `apps/web/src/app/house/`) — brand landing page. One container, one image, three hostnames.

**Identity is `@iedora/auth`.** A shared workspace package (`packages/auth/`) wrapping [better-auth](https://better-auth.com) — email+password, organization plugin, admin plugin. In-process, no separate IdP. Backed by a dedicated `core` Postgres database.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components).
- **TypeScript** strict, every workspace.
- **Drizzle ORM** + `postgres-js`, **Postgres 18**.
- **`better-auth`** via the shared **`@iedora/auth`** package.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives from **`@iedora/design-system`**.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator. **Production runtime is Node** — `bun + next build` is unstable as of 2026 (oven-sh/bun#23944); `next start` runs under Node in the production container.
- **Kamal** — deploy tool (SSH + Docker, zero-downtime hot-swap).

## Hard rules — cross-product

@docs/agents/cross-product-rules.md

## Hard rules — per product

- **[products/menu/CLAUDE.md](products/menu/CLAUDE.md)** — 17 rules: tenant scoping, schema source-of-truth, auth in DAL (not layouts), `proxy.ts`, money in cents, dnd-kit position columns, registry pattern, public-menu cache by tag, beacon view tracking, slice boundaries, co-located E2E + testing surface per slice, **redirects via `publicUrl()`**.
- **[apps/web/CLAUDE.md](apps/web/CLAUDE.md)** — 5 rules: routes vs slices boundary, proxy.ts host dispatch, shared chrome (DashboardPage), no tsconfig path aliasing, one image serves all hosts.

## Slice pattern

@docs/agents/slice-pattern.md

## File layout

```
iedora/
  bun.lock
  package.json                           workspaces: packages/* + products/* + apps/*
  config/
    deploy.yml                           Kamal base config (service, image, accessories,
                                         env, proxy, builder)
    deploy.production.yml                Production overlay (servers, add-host)
    postgres/init.sql                    CREATE DATABASE menu / core / imopush
  .kamal/
    secrets.production                   DB URLs, S3, tunnel token, OTel (BWS).
                                         Registry password vem do env
                                         (Actions secret em CI).

  home-infra/                            Genérico — sem hardcodes de app
    scripts/
      bootstrap.sh                       Server-side prereqs + boot services
      install-kamal.sh                   apt + ruby + kamal + bws + ssh-loopback
    openobserve/ + gitea/                Services partilhados (bin.sh + compose)
    my-services/iedora/                  App-specific (cf-tunnel, r2, setup-repo)
      scripts/bootstrap.sh               1 cmd: cf-tunnel + r2 + setup-repo

  dev/
    docker-compose.yml                   Postgres + s3mock (local dev)
    .env                                 Port vars

  packages/
    eslint-config/
    auth/                                better-auth instance + Drizzle schema + AC taxonomy
    design-system/                       CSS + React primitives
    iedora-observability/                OTel wiring

  apps/
    web/                                 Next.js 16 — serves all 3 hostnames
      src/proxy.ts                       Host-based rewrite
      src/app/                           Routes (menu, core, house, api)
      Dockerfile                         Multi-stage, Kamal label, Node runtime

  products/
    menu/                                Menu slices, schema, i18n, templates
```

## Deploy

### Day 0 — Bootstrap

```bash
export BWS_ACCESS_TOKEN='...' HOMELAB_HOST='ssh://root@<ip>'
./home-infra/scripts/bootstrap.sh                       # install-kamal + boot services
./home-infra/my-services/iedora/scripts/bootstrap.sh    # cf-tunnel + r2 + setup-repo
```

### Day 1+ — Kamal

```bash
kamal setup -d production                 # primeira vez
kamal deploy -d production                # deploys seguintes
kamal rollback -d production              # rollback
kamal details -d production               # status
```

### Ops

```bash
ssh root@192.168.50.53
docker logs -f --tail=200 iedora-web
docker exec -it iedora-web-postgres psql -U postgres
```

## Commands

- `bun install` — install/refresh every workspace.
- `bun install --frozen-lockfile` — CI equivalent.
- `bun run dev` — Next.js HMR (`apps/web`).
- `bun run dev:up` — docker compose up (postgres + s3mock).
- `bun run dev:migrate` — run all DB migrations locally.
- `bun run typecheck` / `lint` / `test` — across all workspaces.

## CI

Gitea Actions workflow único em `.gitea/workflows/ci.yml` com 3 jobs:
`ci` (typecheck + lint + test), `audit` (gitleaks + hadolint + osv),
`deploy` (Kamal deploy via remote SSH builder, gated por `needs: [ci,
audit]` em push a main).

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `node_modules/better-auth/` — auth instance, plugins, server APIs.
3. `docs/deploy/README.md` — infra + deploy com Kamal.
4. `docs/dev.md` — local dev.
5. `products/menu/src/features/README.md` — slice inventory.
6. `packages/<package>/README.md` — each package's surface.
7. `apps/web/CLAUDE.md`, `products/<x>/CLAUDE.md` — scope-local rules.

## MCP servers

[`.mcp.json`](.mcp.json) — checked in. All `bunx`-launched.

| Server | Purpose | Needs |
|--------|---------|-------|
| `shadcn` | Pull shadcn/ui component sources | — |
| `postgres` | Read-only query of local `menu` DB | local Postgres on `:5432` |
| `bun` | Run Bun scripts/tests via MCP | — |
| `next-devtools` | Next.js 16 devtools introspection | — |
| `playwright` | Drive a browser for E2E exploration | — |
