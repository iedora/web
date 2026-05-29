# products/core — auth + admin guards

The `core` product surface — sign-in / sign-up / sign-out / sessions
admin — runs at `core.iedora.com`. After the Opt-B refactor, the
**Next.js routes live in `apps/web/src/app/core/`**; this package only
exposes the server-only guards those routes import.

Repo-level conventions: [`../../AGENTS.md`](../../AGENTS.md).
Auth SDK contract: [`../../packages/core-auth/README.md`](../../packages/core-auth/README.md).

## What's here

- `src/guards.ts` — `getSession()` + `requireIedoraAdmin()`. Thin
  wrappers over `@iedora/core-auth`'s API, tagged `'server-only'`.
- `src/index.ts` — package barrel; re-exports the guards.

## What's NOT here (lives in apps/web)

- `apps/web/src/app/core/page.tsx` — /core landing (redirects based on session)
- `apps/web/src/app/core/layout.tsx` — shared core chrome
- `apps/web/src/app/core/(auth)/layout.tsx` — centered auth-flow chrome
- `apps/web/src/app/core/(auth)/sign-in/{page,sign-in-form}.tsx`
- `apps/web/src/app/core/(auth)/sign-up/{page,sign-up-form}.tsx`
- `apps/web/src/app/core/(auth)/sign-out/{page,sign-out-action}.tsx`
- `apps/web/src/app/core/admin/{page,layout}.tsx` + `admin/{access,audit,organizations,sessions,users}/...`

## Hard rules

1. **Sign-in / sign-up / sign-out live ONLY at apps/web/src/app/core/.**
   Every other product redirects cross-origin to `core.iedora.com/sign-in`
   (built via `signInUrl()` from `@iedora/brand`). No product mounts
   its own `/sign-in` route.

2. **Admin surfaces are gated by `iedora-admin` role.** Use
   `requireIedoraAdmin()` from this package at the top of any admin
   route. It redirects unauth callers to `/sign-in` and 404s
   non-admin users.

3. **No menu / restaurant code here.** Sessions admin reads via
   `auth.api.listUsers` + `auth.api.listUserSessions` — never queries
   menu's `restaurant` table. The product-menu boundary is enforced
   even though both render in the same Next.js process.

## Commands

- `bun run typecheck`
- `bun run lint`
- `bun run test` — vitest with `--passWithNoTests` (no test files yet).
- `bun run test:e2e` / `:ui` / `:debug` — Playwright suite (planned — harness not yet built). See [`docs/testing/e2e-architecture.md`](../../docs/testing/e2e-architecture.md).

CI: Gitea Actions — single `ci.yml` workflow typechecks + lints + tests
all workspaces (see `.gitea/workflows/ci.yml`).

## Testing

Core has no Drizzle schema of its own — the `core` database is owned by `@iedora/core-auth` (better-auth tables + audit log). Unit tests use `fake-gateway.ts` adapters; E2E tests will use the shared `e2e-run` composite action with `needs_product_migrations: false`.

See [`docs/testing/e2e-architecture.md`](../../docs/testing/e2e-architecture.md) for the E2E contract and [`docs/testing/todos/e2e-implementation.md`](../../docs/testing/todos/e2e-implementation.md) for the implementation checklist.
