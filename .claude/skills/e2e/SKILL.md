---
name: e2e
description: Use to run the unified Playwright E2E suite (apps/web). Brings up Postgres + S3Mock via bun run dev:up, applies migrations for every product schema, builds apps/web, then runs `bun run test:e2e`. Use after UI/auth/data-layer changes when typecheck alone isn't enough.
---

# e2e

One Playwright config in `apps/web/`, every product runs through it. Specs live with the slice that produces the behaviour — `products/<p>/src/features/<slice>/e2e/*.spec.ts` plus per-product journeys at `products/<p>/tests/e2e/journeys/`. The Playwright config in `apps/web/playwright.config.ts` glob-discovers them.

Each product is a Playwright `project` (`menu`, `core`, `imopush`). Locally you can run them all (`bun run test:e2e`) or scope to one (`bun run test:e2e -- --project=menu`).

## Flow

1. **Infra up:** `bun run dev:up` (Postgres + S3Mock + observability). Wait until everything is healthy.
2. **Apply migrations for every product schema:** from `apps/web/`, run `bun run db:migrate:test`. This applies the core (better-auth) schema AND every product's Drizzle schema in one go.
3. **Run the suite:** from `apps/web/`, run `bun run test:e2e`. Interactive: `bun run test:e2e:ui` or `bun run test:e2e:debug` (sets `PWDEBUG=1`). Playwright's `webServer` does the production build automatically locally — no separate `bun run dev`.
4. **Scope to a project:** `bun run test:e2e -- --project=menu` (or `--project=core`, `--project=imopush`).

Full architecture and decisions in [docs/testing/e2e-architecture.md](../../../docs/testing/e2e-architecture.md).

## When tests fail

- Read the Playwright HTML report under `apps/web/playwright-report/`.
- Re-run a single failing spec: `bunx playwright test path/to/spec.ts -g "test name"` (run from `apps/web/`).
- Use the `playwright` MCP for interactive exploration of the failing flow.
- Tenancy regressions are the highest-priority failure class — they map to menu's hard rule #1. Don't skip or `.fixme` them.

## Don't

- Don't mock the database. The suite hits the real Postgres in the dev stack; that's the whole point.
- Don't run `next dev` for E2E — `webServer` builds and serves a production build, exactly like prod.
- Don't add a `playwright.config.ts` inside a product. There is one config, in `apps/web/`.
- Don't commit `.env.test.local` overrides.
