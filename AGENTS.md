<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> Bun-workspaces monorepo with a **Go backend**. The Next.js app
> (`apps/web/`) is UI-ONLY — it serves `menu.iedora.com` (menu app,
> incl. sign-in/up/out) and `iedora.com` (house landing)
> through a Host-based rewrite in `src/proxy.ts`. ALL data, auth and
> business rules live in the Go services (`services/` — one Go module,
> independently deployable binaries). The frontend talks to them over
> HTTP, server-side only.

## What this is

- **Menu** (menu.iedora.com — `apps/web/`) — SaaS multi-tenant restaurant menu builder, including the auth pages (`/sign-in|/sign-up|/sign-out` over the Go auth service). UI in `products/menu/`; backends in `services/cmd/menu` + `services/cmd/auth`.
- **House** (iedora.com — `apps/web/src/app/house/`) — brand landing page. One container, one image, two hostnames.
- **Admin** (admin.iedora.com — `services/cmd/admin`) — staff console (users, tenants, sessions, audit, billing). Go templ+HTMX BFF; NOT part of the Next.js app.

**Identity is the Go auth service** (`services/cmd/auth`): email+password,
EdDSA access JWTs (15 min) + rotating refresh cookie, tenants/memberships.
The Next side is BFF-lite (`@iedora/api-client`): auth server actions
(`products/menu/src/features/auth/actions.ts`) mirror
the access token into the HttpOnly `iedora_access` cookie, `src/proxy.ts`
refreshes it for protected routes, and `serverFetch` attaches the Bearer on
every Go API call. The browser NEVER calls the Go services directly.

## Stack

- **Go** (`services/`) — chi, pgx, NATS JetStream (audit outbox), Ed25519 JWTs, OTel. Postgres 18, one database per service, migrations owned by each service (`<svc> migrate`).
- **Next.js 16** (App Router, Turbopack default) — UI only: RSC reads via `serverFetch`, mutations via server actions.
- **TypeScript** strict, every workspace.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives from **`@iedora/design-system`**.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator. **Production runtime is Node** — `bun + next build` is unstable as of 2026 (oven-sh/bun#23944).
- **Deploy** — owned by the `iedora-infra` repo (Docker Swarm + Ansible + OpenTofu). This repo ships images: `apps/web/Dockerfile` (UI) and `services/Dockerfile` (Go binaries).

## Hard rules — cross-product

@docs/agents/cross-product-rules.md

## Hard rules — per product

- **[apps/web/CLAUDE.md](apps/web/CLAUDE.md)** — routes vs slices boundary, proxy.ts host dispatch, shared chrome (DashboardPage), no tsconfig path aliasing, one image serves all hosts.
- **Backend changes go in `services/`** — see [services/README.md](services/README.md). Never reintroduce databases, ORMs, S3 clients or AI SDK calls into the TypeScript side.

## Slice pattern

@docs/agents/slice-pattern.md

## File layout

```
iedora/
  bun.lock
  package.json                           workspaces: packages/* + products/* + apps/*
  services/                              Go backend — auth, menu, audit, billing, admin (one module)
    cmd/<svc>/                           entrypoints; deploy/stack.yml + secrets
    docker-compose.yml                   FULL local backend: Go services + Postgres + NATS + MinIO + OpenObserve

  packages/platform/                     Foundation tier — zero product knowledge
    api-client/                          @iedora/api-client — Go-backend HTTP client: cookies, session, serverFetch, middleware refresh
    brand/                               @iedora/brand — brand strings, product registry, URL validators
    design-system/                       @iedora/design-system — CSS tokens + React primitives
    eslint-config/                       @iedora/eslint-config — shared ESLint config
    observability/                       @iedora/observability — OTel wiring (Next side)

  apps/web/                              Next.js 16 — serves both hostnames, UI only
    src/proxy.ts                         Host rewrite + auth gate + token refresh
    src/app/                             Routes (menu incl. (auth), house, up)
    Dockerfile                           Multi-stage, Node runtime

  products/
    menu/                                @iedora/product-menu — menu UI slices (incl. auth) + typed Go client (src/shared/api.ts)
```

## Commands

- `bun install` — install/refresh every workspace.
- `bun run dev:up` — docker compose up the FULL Go backend (services/docker-compose.yml: services + Postgres :55432 + NATS + MinIO + OpenObserve).
- `bun run dev` — Next.js HMR (`apps/web`) against that backend.
- `bun run typecheck` / `lint` / `test` — across all TS workspaces.
- `cd services && make test` / `make test-integration` — Go unit / testcontainers suites.

## CI

GitHub Actions, [`.github/workflows/ci.yml`](.github/workflows/ci.yml):
path-filtered correctness (typecheck + lint + test), the Go backend
pipeline (test + build/push), and security (gitleaks + hadolint +
osv-scanner).

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `services/README.md` — the Go backend's architecture + API surface.
3. `products/menu/src/shared/api.ts` — the typed contract the UI consumes.
4. `docs/runbook.dev.md` / `docs/runbook.deploy.md` — dev + deploy.
5. `products/menu/src/features/README.md` — slice inventory.
6. `apps/web/CLAUDE.md` — scope-local rules.
