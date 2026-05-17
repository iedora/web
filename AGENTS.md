<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Iedora monorepo — project conventions

> This is a **Bun-workspaces monorepo**. Two Next.js products
> (`products/menu/`, `products/genkan/`), one Astro static site
> (`products/house/`), and three workspace packages
> (`packages/design-system/`, `packages/iedora-identity/`,
> `packages/iedora-auth-testkit/`). `bun install` runs ONCE at the repo
> root and resolves every workspace; you almost never `cd` to install.
>
> Most hard rules below come in two parts — a "Menu" set (the rules
> that have been here since the menu app started) and a "Genkan" set
> (the IdP's load-bearing constraints). Paths starting with `src/...`
> are relative to whichever product directory the rule talks about.
> The house product is a static landing page; it has no code-level
> conventions beyond `products/house/README.md`.

## What this is

**iedora** is the umbrella. Two products federate through it:

- **Menu** (menu.iedora.com — `products/menu/`) — a SaaS multi-tenant
  restaurant menu builder. Each tenant is an organization that owns
  one or more `restaurant` rows. Admins build menus via drag-and-drop;
  the public menu renders from the same data. Menu owns ZERO
  organization data of its own — every organization read/write goes
  over HTTP to genkan via `src/features/identity/`.
- **Genkan** (genkan.iedora.com — `products/genkan/`) — the iedora
  IdP. Better Auth + `@better-auth/oauth-provider` + the
  `organization` and `admin` plugins. Owns the canonical user,
  session, organization, membership, OAuth-client, audit-log and
  webhook-subscription tables. Every other product authenticates
  through genkan via OIDC; every product receives identity events
  via signed webhooks. "Genkan" is Japanese for the entryway of a
  house — the room you pass through to get inside.
- **House** (iedora.com — `products/house/`) — the umbrella brand
  landing page. Astro static output, deployed to Cloudflare Workers
  Static Assets. Deliberately small. No DB, no auth.

## Stack

- **Next.js 16** (App Router, Turbopack default, Cache Components) — both products.
- **TypeScript** strict — every workspace.
- **Drizzle ORM** + `postgres-js` driver, **Postgres 18**.
- **Better Auth 1.6.11** — pinned exact across the repo. Menu uses
  the core plus the bundled `organization` plugin (federated to
  genkan); genkan also runs **`@better-auth/oauth-provider`
  1.6.11**, plus the `admin` and `organization` plugins, plus the
  built-in `jwt` plugin for OIDC.
- **shadcn/ui** + Tailwind v4 — menu only. Editorial primitives
  (Wordmark, Card, Dialog, …) come from
  **`@iedora/design-system`** for ALL three products.
- **@dnd-kit** — menu's drag-and-drop builder.
- **Bun** — package manager, test runner, dev orchestrator.
  `bun install` at the repo root resolves every workspace; the
  workspace lockfile is `bun.lock`. **Production runtime is
  Node** — `bun + next build` is unstable as of 2026
  (oven-sh/bun#23944), and `next start` runs under Node in Kamal.
- **`@iedora/auth-testkit`** — workspace fixture that boots a real
  Better Auth + OAuth-provider against PGLite for integration tests
  in any product that consumes genkan. See `docs/testing.md` for the
  full walkthrough.

## Hard rules — Menu

These hard rules are scoped to `products/menu/`. Paths are
menu-relative.

1. **Tenant scoping is mandatory.** Every query touching `restaurant`, `menu`, `category`, or `item` MUST filter by `restaurantId` AND verify the caller is a member of the parent organization. Never trust IDs from the client without rechecking ownership. Centralize this in `src/features/auth/` — use `requireRestaurantAccess(restaurantId)` before any tenant query. Organization membership is resolved through `src/features/identity/` (HTTP to genkan), not from a local table.

2. **Schema is the source of truth.** `src/shared/db/schema.ts` is the single canonical schema. Migrations are generated, not handwritten — run `bun run db:generate` then `bun run db:migrate`.

3. **Auth checks belong in the data layer, not in layouts.** Layouts in Next 16 don't re-render on navigation, so an auth check in a layout WILL leak. Use `verifySession()` / `requireRestaurantAccess()` from `src/features/auth/` close to the data fetch or in the page component itself. The dashboard layout fetches session/plan defensively for chrome (email, Analytics link) but never redirects from there.

4. **Use shadcn via MCP** when possible. `bunx shadcn@latest add <component>` works too. Don't hand-write primitives that already exist in shadcn (menu) or `@iedora/design-system` (all products).

5. **No `middleware.ts`.** Next 16 renamed it to **`proxy.ts`**. The proxy is for *optimistic* redirects only (cookie presence checks). Real auth always lives in the DAL.

6. **Money is integer cents** in `priceCents`, currency in a separate column. Never use floats for prices.

7. **Drag-and-drop reordering** uses integer `position` columns (per parent). On reorder, recompute positions for affected rows in a single transaction. Renumber periodically if gaps grow.

8. **Menu templates are open/closed.** Each template lives in its own folder under `src/features/menu-publishing/rsc/templates/<id>/` and exports a `template: MenuTemplate` from `index.ts`. The renderer (`menu-renderer.tsx`) consumes only the registry — never edit it to support a new template. Adding a template = new folder + 1 import + 1 entry in `templates/registry.ts` + the literal in `RestaurantTheme.layout` (schema). LAYOUTS in `src/features/menu-publishing/rsc/theme.ts` is derived from the registry; do not maintain it separately.

9. **Asset keys are tenant-prefixed and verified twice.** Every uploaded object's S3 key starts with `r/{restaurantId}/`. The `requireRestaurantAccess` DAL guard runs first; `assertKeyBelongsToTarget` then rejects any commit whose key doesn't match the target's restaurant — defense-in-depth against a stale presign being redirected. New asset targets must follow the same `r/{restaurantId}/...` scheme in `src/features/upload/targets.ts` and gate item-scoped uploads with an extra ownership check (see `assertItemBelongsToRestaurant`).

10. **Languages live in a registry.** Each supported language is a self-contained module under `src/features/i18n/languages/<code>/` exporting `language: Language` from its `index.ts`. `src/features/i18n/registry.ts` is the only place that knows the full set; `LANGUAGE_CODES`, `LANGUAGE_META`, and `getLanguage` are derived. The Zod schemas in actions use `z.record(z.string(), …).refine(keys ⊂ LANGUAGE_CODES)` because Zod 4 makes `z.record(z.enum([...]), …)` exhaustive. Translatable text uses the pattern: plain `name`/`description` text columns are the source of truth for the restaurant's `defaultLanguage`; sibling jsonb `*I18n` columns carry overrides for non-default languages. Fallback chain at render time: requested → default → empty. New languages: see `/add-language` skill.

11. **Plans live in a registry.** Same shape as languages and templates: each plan is a folder under `src/features/plans/<code>/` exporting `plan: Plan` from `index.ts`; `src/features/plans/registry.ts` derives `PLAN_CODES`, `PLANS`, `getPlan`. Adding a plan = new folder + new literal in `PlanCode` union + new registry entry. Gates use `canAddRestaurant(orgId)` (returns structured `{ ok, reason, limit }` — never throws) and `planHas(plan, feature)`. The DB column `organization.plan` stores raw text; `getPlan` coerces unknown values back to the default so a renamed plan never crashes a render.

12. **Public menu is cached, invalidated by tag.** `loadRestaurantSnapshot(slug)` and `loadRestaurantAdminMenus(slug)` (use-cases in `src/features/menu-publishing/use-cases/`) wrap `unstable_cache` with a per-slug tag `restaurant:${slug}` via `src/features/menu-publishing/cache.ts`. Every mutation that affects the restaurant's public or admin view MUST call `revalidateRestaurant(slug)` (which uses `updateTag` for read-your-own-writes semantics, not `revalidateTag`). The single chokepoint is enforced — never call `revalidatePath('/r/${slug}')` from a mutation action; the cache tag is what matters. **Date gotcha:** `unstable_cache` JSON-serializes Dates to ISO strings; if a cached function returns a Date the caller will see a string. Hydrate explicitly in the loader (see `loadRestaurantAdminMenus`).

13. **View tracking is beacon-based, not server-render-coupled.** `/api/track/[slug]` is a pixel-beacon route that lives outside the cached snapshot — it runs on every public visit, even when the page itself is served from cache. Dedup is `(visitor_cookie, restaurant_id, hour_bucket)` via `view_seen.onConflictDoNothing`; only newly-inserted rows trigger `incrementDailyView`. Bot UAs filtered at the route. **Never put the view increment back inline in the page** — that breaks the moment a CDN sits in front.

14. **Slices are vertical and own everything for one capability.** Files inside a slice import via *relative* paths; cross-slice imports MUST go through the sibling slice's `index.ts` (the single barrel) — enforced by `eslint-plugin-boundaries` in `eslint.config.mjs`. `src/shared/` is for primitives with no domain knowledge (db client, env, ui primitives, testing fixtures). `src/app/` is delivery — routes import from slices and shouldn't carry business logic. Use-cases take their port as the first argument so the test suite wires fakes against a real PGLite database (see `src/features/auth/auth.test.ts`); production wires the Drizzle adapter once in the slice's `index.ts` or `actions.ts`.

## Hard rules — Genkan

These rules are scoped to `products/genkan/`. Genkan reuses the same
slice shape as menu, so all of menu's rules about ports / use-cases /
adapters / barrels (rules 2, 3, 5, 14) apply verbatim. The ones below
are the extra constraints specific to running the IdP.

1. **Tenant scoping in genkan is two-tier.** `/admin/*` requires
   `requireAdmin()` (reads `user.role === 'admin'` from the user row
   — the field is `input: false` so public sign-up cannot set it,
   pinned by `src/features/auth/__tests__/role-escalation.test.ts`).
   Tenant-scoped reads outside admin use
   `requireActiveOrganization()`. Both live in
   `src/features/auth/use-cases/`; `requireAdmin` is in
   `src/features/admin/use-cases/require-admin.ts`. Layouts don't
   guard — the DAL does. Same lesson as menu rule 3.

2. **Audit chain integrity is enforced via a Postgres advisory
   lock.** Every `record()` call serialises through
   `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_KEY = 1224391960)` so the
   chain (`prev_hash → row_hash`) is tamper-evident even when N
   admin requests interleave. The hash covers a fixed field order
   (see `src/features/audit/chain.ts`); reordering or adding fields
   to the hash input is a chain rebuild and breaks every existing
   verifier. The verifier
   (`src/features/audit/chain.ts::verifyAuditChain`) walks rows in
   order and re-derives each hash; the `/admin/audit` page calls
   it and renders a green/red banner via
   `chain-status.client.tsx`. Never write to `audit_log` outside
   the slice's `record()` use-case.

3. **JWKS rotation is automatic + in-process.**
   `src/features/auth/cron.ts::startCron()` is started exactly once
   per Node process from `src/instrumentation.ts` (gated on
   `NEXT_RUNTIME === 'nodejs'`). It nudges hourly; the use-case
   rotates only when the latest key is older than 90 days.
   Multi-replica safe via
   `pg_advisory_xact_lock(JWKS_ROTATION_LOCK_KEY = 3828642905)` —
   even if N replicas all wake on the same hour boundary exactly
   one rotates. Manual override is the "Rotate now" button at
   `/admin/applications`, which calls the same use-case with
   `force: true`. The button is gated by `requireAdmin` AND
   `requireFreshSession`.

4. **Reauth gate guards every destructive admin action.** The list
   today: `user.ban/unban`, role change to admin, `user.delete`,
   `user.impersonate`, `org.delete`, `app.delete`,
   `webhook.delete`, `webhook.rotate-secret`, `jwks.rotate`. Each
   action server-side calls `requireFreshSession({ returnTo })`
   from `src/features/auth/use-cases/require-fresh-session.ts`,
   which redirects to `/reauth?return_to=…` if `lastPasswordAt`
   on the session row is older than `maxAgeMin` (default 5).
   `lastPasswordAt` is a Better Auth session-additional-field
   set on session create and refreshed by the `/reauth` flow.
   Forget the guard → an attacker with a stolen cookie can
   nuke a tenant in one click.

5. **Webhook secrets are encrypted at rest.** The cipher lives in
   `packages/iedora-identity/src/secret-storage.ts` — AES-256-GCM
   with an HKDF-derived key (input keying material:
   `BETTER_AUTH_SECRET`). New webhook subscriptions are encrypted
   on insert; existing rows are decrypted in-flight before the
   sender signs the envelope. Never store a plaintext webhook
   secret in `webhook_subscription.secret` (or any other column).

6. **Impersonation is fully audited, BEFORE-and-AFTER the cookie
   flip.** `src/app/admin/users/[id]/actions.ts::impersonateAction`
   writes the `user.impersonate` audit row BEFORE swapping the
   session cookie (so the audit record is attributed to the
   admin's session, not the impersonated user's).
   `src/app/(authed)/impersonation-actions.ts::stopImpersonatingAction`
   writes the `user.impersonate_stop` row AFTER the flip back.
   While impersonating, `src/app/(authed)/impersonation-banner.tsx`
   renders a cinnabar banner on every authed page whenever
   `session.session.impersonatedBy` is set. Reordering the audit
   write vs the cookie flip is a security regression — the test
   in `src/features/auth/__tests__/impersonation.test.ts` pins
   the ordering.

7. **Telemetry is OFF on both apps.** Better Auth 1.6 ships an
   opt-out telemetry collector — both apps explicitly set
   `telemetry: { enabled: false }` in `better-auth-instance.ts`.
   Genkan additionally pins
   `emailAndPassword.minPasswordLength: 12` (menu inherits the
   default; menu sign-up flows through genkan anyway, so the
   policy is effectively centralised).

## Pattern: how to add a feature

Reference templates: `src/features/auth/` in either product.
`src/features/audit/` in genkan is a slightly larger example
(adapter + chain library + verifier + use-cases + tests).
The shape is the same in menu and genkan:

1. `mkdir src/features/<slice>/{adapters,use-cases,ui}` — `ui/` only if the slice owns React components.
2. Define **`ports.ts`** — narrow interfaces describing every effect the slice needs (db reads/writes, external APIs). One method per atomic op; no Drizzle / Next types leak through.
3. Write the production **`adapters/drizzle.ts`** (or `better-auth.ts`, `s3.ts`, `genkan-http.ts`, …). Marked `'server-only'`. Implements the port against the real world.
4. Write **`use-cases/<verb>.ts`** as pure-ish async functions: `(port, input) => result`. No `redirect()` / `headers()` access except via the port — that's what lets Vitest run them against PGLite.
5. Expose the slice via **`index.ts`** — `React.cache()`-memoize page loaders that fan out to children. Re-export types callers need. Don't export the adapter itself.
6. If the slice has mutations, add **`actions.ts`** with `'use server'` at the top: auth guard → `runUseCase(productionAdapter, input)` → `revalidateRestaurant(slug)` (menu) / `revalidatePath(...)` (genkan; no cached snapshot to invalidate by tag). Server actions don't live in `index.ts` — Next's directive doesn't traverse barrels reliably.
7. Add a co-located **`<slice>.test.ts`** (menu) or **`__tests__/<verb>.test.ts`** (genkan) next to the source — `makeTestDb()` from `@/shared/testing/pglite`, real Drizzle queries, fakes only at the port boundary. If you need a real OIDC handshake, reach for `@iedora/auth-testkit`'s `startTestGenkan()`.
8. Add a short **`README.md`** at the slice root documenting the public API.

For asset targets, languages, plans, templates: the registry
pattern is already encoded in the matching skill
(`add-asset-target`, `add-language`, `add-template`).

## File layout

The repo is a Bun workspace: `bun.lock` at the root, every
workspace under `packages/*` or `products/*`. Sibling products
never share files — anything that looked shared (BWS credentials,
the Cloudflare zone) gets duplicated per product so each one is
independently appliable.

```
iedora/                                  repo root
  bun.lock                               single workspace lockfile
  package.json                           workspaces: packages/* + products/{menu,genkan,house}
  justfile                               just modules: menu::, genkan::, house::
  .github/                               composite setup action + reusable workflows (see "CI" below)
    actions/setup/action.yml             composite: install Bun + bun install --frozen-lockfile
    workflows/ci.yml                       orchestrator: paths-filter → per-concern + reusable calls
    workflows/_unit.yml                    reusable: one Vitest job per workspace
    workflows/_e2e.yml                     reusable: menu Playwright suite (owns env literals)
  .mcp.json                              shadcn, postgres, bun, next-devtools, playwright MCP servers
  docs/                                  brand-level docs (deploy, scaling, backups, secrets,
                                         security-audit, tenancy, vendors, architecture, testing)

  packages/
    design-system/                       @iedora/design-system — editorial CSS + React primitives
      src/
        index.ts                         component barrel (Wordmark, Card, Dialog, Button, …)
        components/                      ~25 primitives — see README's §VI listing
        styles.css                       paper/ink/cinnabar palette + Manual classes
        tokens.css, fonts.css            CSS custom properties + (optional) Fraunces/JBMono
      README.md                          quickstart + design intent
    iedora-identity/                     @iedora/identity — webhook sender+receiver+envelope
      src/
        index.ts                         barrel
        events.ts                        IdentityEvent union (source of truth, both ends)
        signature.ts                     Stripe-style x-iedora-signature header
        sender.ts                        signs, POSTs, retries on 5xx, gives up on 4xx
        receiver.ts                      verify + dedup + handler dispatch
        ssrf.ts                          DNS-resolve + private-CIDR reject (rebind gap noted)
        secret-storage.ts                AES-256-GCM HKDF cipher used for stored webhook secrets
        __tests__/                       crypto + parsing unit tests (no DB)
      README.md                          surface + security model
    iedora-auth-testkit/                 @iedora/auth-testkit — in-process Better Auth + PGLite
      src/
        index.ts                         startTestGenkan + signTestToken
        start-test-genkan.ts             boots node:http, wires Better Auth, applies migrations
        schema.ts                        re-export of genkan's schema (subpath: ./schema)
        push-schema.ts                   drizzle migrations runner against PGLite
        seed.ts                          {user,organization,member,grant} convenience seeders
        sign-test-token.ts               mint a JWT signed by the test instance's JWKS
        __tests__/                       smoke + handshake + seed sanity tests
      README.md                          worked example + API table

  products/
    menu/                                menu product (menu.iedora.com)
      src/
        app/                             Next.js App Router
          (auth)/                          public auth pages (signup, login) — bounce to genkan
          _components/landing/             landing-page.tsx + landing.css (public home)
          dashboard/                       admin pages — protected
            analytics/                     Casa-only KPIs + scan chart; free → billing redirect
            billing/                       current plan + invoice ledger (year filter)
            r/[slug]/                      restaurant home
              m/[menuId]/                  dnd-kit menu builder route
              theme/                       settings: identity + theme editor
              qr/                          QR code generator
            layout.tsx, page.tsx
          r/[slug]/                        public menu page per restaurant — cached snapshot
          onboarding/                      first-org-creation AND add-another-restaurant flow
          api/
            auth/[...all]/                 Better Auth handler (also receives genkan's OIDC callbacks)
            track/[slug]/                  pixel-beacon view tracking (cookie dedup + bot filter)
            identity/webhook/              receives genkan webhooks via @iedora/identity
          up/                              health-check route
          showcase/                        public marketing surface (template gallery)
          page.tsx, layout.tsx, globals.css
        features/
          auth/                          session + tenant-scoping guards (Better Auth client to genkan)
          billing/                       invoice ledger
          dashboard-home/                restaurants-with-counts aggregate query
          i18n/                          per-language registry (en, pt, es, fr) + format helpers
          identity/                      OAuth-bearer adapter — HTTP to genkan /api/identity/organization/*
          menu-builder/                  dnd-kit admin builder
          menu-publishing/               public menu cache + renderer + template registry + sample seed
          metrics/                       daily-view + analytics range helpers
          plans/                         plan registry (free, casa) — same pattern as i18n/templates
          rate-limit/                    Redis (testcontainers in dev/CI) — Better Auth rate-limit store
          restaurant-identity/           restaurant CRUD + theme/identity settings
          upload/                        S3-compatible uploads + presign/commit/clear (LocalStack in CI)
        shared/
          db/{client.ts,schema.ts}       drizzle client + canonical schema (no auth.* — genkan owns it)
          env.ts                         Zod-validated env (build-time stub when SKIP_ENV_VALIDATION=1)
          brand.ts                       brand strings + GENKAN_URL (inlined into client bundle at build)
          ui/                            shadcn primitives + editorial-list
          testing/pglite.ts              makeTestDb() fixture
          utils.ts                       cn() helper
        proxy.ts                         Next 16 proxy (was middleware) — optimistic redirects only
        i18n/                            next-intl request config + message catalogues
      drizzle/                           generated SQL migrations
      drizzle.config.ts                  schema path → ./src/shared/db/schema.ts
      next.config.ts, tsconfig.json      Next + TS config (paths: @/* → ./src/*)
      docker-compose.yml                 postgres + localstack (dev only)
      .env.example                       Next.js dev template — copy to .env.local
      package.json                       menu deps; workspace deps to @iedora/{design-system,auth-testkit}
      scripts/
        check-migrations.ts              dev-time guardrail; warns when journal has pending migrations
      tests/e2e/
        fixtures.ts                      auto-fixture: fails fast on any RSC error / 5xx response
        specs/                           organized by module: auth, tenancy, menu-builder, public-menu, …
        helpers/                         shared signup/org/db utilities (uses auth-testkit shim)
      infra/                             menu product's deploy machinery
        Dockerfile                       app build (multi-stage Bun-install + Node-build + standalone)
        justfile                         deploy/destroy/rotate-secret/logs/etc. recipes; `set dotenv-load`
        .env.example                     infra template — copy to infra/.env (gitignored)
        bin/with-secrets                 BWS-env wrapper; injects TF_VAR_* aliases
        tofu/menu/                       Cloudflare tunnel + DNS + R2 buckets (encrypted state)
        kamal/                           Kamal 2 — app + postgres + cloudflared + backups accessories
        backup/                          self-built Postgres-backup image (Dockerfile + bash)

    genkan/                              genkan product (genkan.iedora.com — the IdP)
      src/
        app/
          (auth)/                          login + signup (the only pages public sign-up sees)
          (authed)/                        consent, profile, reauth, impersonation-banner
          admin/                           /admin/* — users, organizations, applications, sessions,
                                           grants, audit, webhooks. Every server action calls
                                           requireFreshSession before mutating.
          api/
            auth/[...all]/                 Better Auth handler (also serves OAuth-provider endpoints)
            identity/organization/*        OAuth-bearer endpoints menu calls into
          up/route.ts                      health check
          layout.tsx, page.tsx, globals.css
        features/
          admin/                         user/org/app/webhook/grant listings + requireAdmin guard
          audit/                         hash-chained audit_log: record + verify + list
            chain.ts                       sha256-chain helpers + AUDIT_CHAIN_LOCK_KEY constant
            verify.ts                      walks the chain, reports first tamper point
            sender.ts                      forwards events to @iedora/identity webhook sender
          auth/                          Better Auth instance + DAL + reauth + JWKS rotation cron
            adapters/better-auth-instance.ts   betterAuth() factory — telemetry off, role.input=false
            adapters/better-auth.ts            gateway adapter
            adapters/bearer-auth.ts            OAuth-bearer verifier for /api/identity/*
            cron.ts                            startCron() — hourly JWKS rotation kick
            oidc/discovery.ts                  custom additions to /.well-known/openid-configuration
            use-cases/require-fresh-session.ts step-up guard for destructive actions
            use-cases/rotate-jwks.ts           advisory-locked rotation use-case
            __tests__/                         impersonation, role-escalation, jwks, fresh-session
          profile/                       user-facing profile reads (org list, grant list)
          webhooks/                      subscription CRUD + dispatch (uses @iedora/identity sender)
        shared/
          db/{client.ts,schema.ts}       drizzle client + canonical schema (auth.* + audit_log + …)
          env.ts                         Zod-validated env
          testing/pglite.ts              makeTestDb() — same shape as menu's
        instrumentation.ts               Next register() hook — starts the cron (nodejs runtime only)
      drizzle/                           generated SQL migrations
      drizzle.config.ts
      package.json                       genkan deps; @iedora/{identity,design-system} workspace deps
      scripts/check-migrations.ts        same guardrail as menu's
      infra/                             genkan's deploy machinery (sibling to menu's)
        Dockerfile, justfile, tofu/, kamal/, bin/with-secrets, .env.example
        # NB: NO backup/ — genkan reuses menu's Postgres accessory over the
        # shared kamal Docker network. Separate logical databases:
        # `metamenu` for menu, `genkan` for genkan.

    house/                               iedora.com root brand site (Astro on Workers Static Assets)
      README.md                          what it is + how to deploy
      astro.config.mjs                   static output → dist/, React integration, port 3002
      package.json                       astro + @astrojs/react + workspace dep on @iedora/design-system
      tsconfig.json                      extends astro/tsconfigs/strict
      wrangler.toml                      Worker config — assets dir + apex custom_domain route
      src/
        pages/index.astro                home page (composes HouseHeader / HouseWorks / HouseFooter)
        layouts/BaseLayout.astro         html shell, Google Fonts
        components/                      HouseHeader, HouseWorks, HouseFooter
        styles/global.css                imports @iedora/design-system/styles.css
      dist/                              build output — what wrangler uploads (gitignored)
      site-legacy/                       pre-Astro static HTML, kept for A/B comparison
      infra/
        justfile                         build → tofu apply (workload token only) → wrangler deploy
        .env.example                     shared BWS access + Cloudflare account id (3 keys)
        bin/with-secrets                 lighter wrapper — no PUBLIC_HOSTNAME / ONPREM_HOST / GHCR_USER
        tofu/                            ONE resource — narrow workers_deploy token
```

## Useful commands

`bun install` runs ONCE at the repo root. The workspace lockfile
covers every package and product; you almost never need to install
inside a sub-package. Dev/test/build scripts run inside the product
or package directory.

### Repo-root commands

- `bun install` — install/refresh every workspace.
- `bun install --frozen-lockfile` — what CI uses; matches `bun.lock` exactly.
- `just` — list every product module + its recipes.
- `just menu` / `just genkan` / `just house` — list one product's recipes.

### Menu (`products/menu/`)

- `bun run dev` — Next.js dev server (Turbopack). Warns at startup when migrations are pending.
- `bun run typecheck` — TS check without emit.
- `bun run lint` — ESLint (boundary rules included).
- `bun run test` / `bun run test:watch` — Vitest unit suite (PGLite, co-located).
- `bun run test:e2e` / `:ui` / `:debug` — Playwright suite (production build + start).
- `bun run db:generate` — generate a Drizzle migration from `src/shared/db/schema.ts`.
- `bun run db:migrate` — apply pending migrations.
- `bun run db:push` — push schema directly (dev only, no migration files).
- `bun run db:studio` — open Drizzle Studio.
- `bun run auth:generate` — sync Better Auth tables into `src/shared/db/schema.ts`.
- `docker compose up -d` — start Postgres + LocalStack (S3 mock).
- `bunx shadcn@latest add <name>` — add a shadcn component.

### Genkan (`products/genkan/`)

- `bun run dev` — Next.js dev server on **port 3001** (menu sits on 3000).
- `bun run typecheck` / `lint` / `test` / `test:watch` — same shape as menu.
- `bun run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle, same shape.
- `bun run auth:generate` — sync Better Auth tables into `src/shared/db/schema.ts`.
- No `test:e2e` script — genkan has no Playwright suite (see `docs/testing.md` for why).

### Packages (`packages/<name>/`)

- `bun run test` / `test:watch` — Vitest. No DB for `@iedora/identity` (pure crypto + parsing); PGLite-backed for `@iedora/auth-testkit`; jsdom-backed for `@iedora/design-system`.
- `bun run typecheck` — TS check; CI runs the product typechecks which transitively cover the packages.

### Deploy (`just <product>::<recipe>` at repo root)

- **First-time setup** (once, manual): `ssh-copy-id root@$ONPREM_HOST` (Kamal's canonical SSH user — root with key-only login); `gh auth refresh -s write:packages`; then `just menu::deploy` followed by `just genkan::deploy`. See `docs/deploy.md` for the homelab key-copy step when root SSH isn't already enabled.
- `just menu::deploy` — menu app: tofu apply + kamal setup/deploy, idempotent. The recipe probes for an existing kamal-proxy container and chooses `setup` vs `deploy` accordingly.
- `just genkan::deploy` — same shape; reuses menu's Postgres accessory on the shared Kamal Docker network (separate logical database: `genkan`).
- `just menu::logs` / `console` / `rollback` and `just genkan::logs` / `console` / `rollback` — direct `kamal` calls; each product's `.env` is auto-loaded via `set dotenv-load`. (Migrations run on container start via the Kamal `cmd:` — no separate `migrate` recipe needed.)
- `just menu::backup` / `restore` — force a Postgres dump now / restore latest (interactive). Backups cover BOTH databases since the accessory lives with menu.
- `just menu::build-backup` — rebuild the backup accessory image (only needed when bumping the Postgres major).
- `just menu::rotate-secret <KEY>` / `just genkan::rotate-secret <KEY>` — rotate one BWS secret (prompts new value, edits BWS, reminds to redeploy). For sub-tokens (R2, tunnel): `cd products/<name>/infra && bin/with-secrets tofu -chdir=tofu apply -replace=<resource>`. See `docs/secrets.md`.
- `just menu::destroy` / `just genkan::destroy` — `tofu destroy` for that product: removes its Cloudflare tunnel + DNS (does NOT touch the box, does NOT touch the other product).
- `just house::deploy` / `house::destroy` — manage iedora.com (Astro build → workload-token refresh → `wrangler deploy` uploading dist/ + apex `custom_domain` route). `just house::build` / `house::preview` for local-only checks.

`just` itself is a Rust task runner — `brew install just` on macOS,
`cargo install just` on the homelab. Replaces the old root + infra
Makefiles.

Build + push lives on the homelab box itself
(`builder.remote: ssh://root@$ONPREM_HOST`, native amd64). Images
are pushed to **GHCR** (`ghcr.io/$GHCR_USER/meta-menu` for menu,
`ghcr.io/$GHCR_USER/genkan` for genkan); auth is `gh auth token`
evaluated from each product's `kamal/.kamal/secrets`. No local
registry, no buildx insecure-registry config, no daemon.json
mutation.

## CI

Structured as an **orchestrator + composite action + reusable workflows**
— the industry-standard shape for monorepos that grow more than two
products (mirrors the pattern in Vercel/Next.js, t3-oss/create-t3-turbo,
nx, and turborepo's own repos).

```
.github/
  actions/setup/action.yml      composite: install Bun + bun install --frozen-lockfile
  workflows/
    ci.yml                       orchestrator (paths-filter + job conditionals)
    _unit.yml                    reusable: ONE Vitest job for ONE workspace
    _e2e.yml                     reusable: menu Playwright suite + owns ALL e2e env literals
```

**Three load-bearing decisions:**

1. **One composite action for setup.** `actions/setup` runs
   `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` at the repo
   root. Every job that needs deps is one line: `uses: ./.github/actions/setup`.
   Bumping Bun or adding a cache layer is a one-file edit.

2. **Reusable workflow for unit jobs.** Each per-workspace test job is a
   four-line `uses: ./.github/workflows/_unit.yml` block with `label` +
   `workdir` inputs. Adding a new product = one filter entry in `changes`
   + one `uses:` block. No new file, no copy-pasted setup.

3. **`dorny/paths-filter` for change detection.** The first job
   (`changes`) emits per-workspace outputs (`menu`, `genkan`, `house`,
   `identity`, `authtestkit`, `design-system`, `shared`); every
   downstream job gates on those outputs via `if: ...`. A docs-only edit
   to `products/menu/` runs only menu's pipeline; a `bun.lock` change
   (the `shared` filter) runs everything. Workflow-level `paths:` was
   rejected because skipped status checks hang PR merges — `if:`
   short-circuits show as `skipped` (success-equivalent for the gate).

**The jobs:**

- **`changes`** — dorny/paths-filter; emits `outputs.<workspace>`.
- **`typecheck-menu`, `typecheck-genkan`** — `tsc --noEmit` per product.
- **`lint-menu`** — menu-only (eslint-plugin-boundaries lives in the
  menu config). Genkan has a thin `eslint.config.mjs` but no
  dedicated lint job yet.
- **`unit-menu`, `unit-genkan`, `unit-identity`, `unit-authtestkit`** —
  all delegate to `_unit.yml`.
- **`e2e`** — delegates to `_e2e.yml`; gated on `!failure() && !cancelled()`
  (not plain `success()`) so a docs-only edit that legitimately skips
  upstream units doesn't block the gate.

**Where env lives:**

- **Workflow-level (ci.yml)** — empty: orchestrator doesn't need any.
- **Job-level (`_e2e.yml` env block)** — every e2e env literal:
  `DATABASE_URL`, `GENKAN_*`, `NEXT_PUBLIC_GENKAN_URL`, `S3_*`. These
  aren't secret (they're CI fixtures), so they live in code, not in
  GH Secrets. The reusable workflow is the single home for them —
  adding one is a one-line edit there.
- **GH Secrets** — only `BETTER_AUTH_SECRET` (truly sensitive). When
  deploy workflows land, true per-environment secrets graduate to
  **GitHub Environments** (`environment: production` / `staging`).

**Branch protection: deliberately NOT enabled** — solo, AI-driven
project; the CI itself is the signal. Revisit when adding collaborators
or after the first "broken main" incident.

## Where to look when unsure

1. `node_modules/next/dist/docs/` — bundled, version-matched Next.js docs.
2. `node_modules/better-auth/` and the Better Auth README in node_modules — auth APIs (1.6.11 pinned across the repo).
3. `node_modules/@better-auth/oauth-provider/` — the OAuth-provider plugin docs that genkan loads.
4. `node_modules/drizzle-orm/` — query builder, types.
5. `products/<product>/src/features/<slice>/README.md` — every slice has a short doc describing its public API.
6. `packages/<package>/README.md` — every shared package documents its surface.
7. `docs/architecture.md` — the slice playbook (what goes where + how to add a feature).
8. `docs/testing.md` — the test pyramid (Vitest+PGLite unit; auth-testkit integration; Playwright e2e).
9. `docs/security-audit.md` — the security model + audited surface.
10. `docs/tenancy.md` — how tenancy works across the federation boundary.
11. `docs/vendors.md` — every paid + free dependency with rationale.
12. `docs/deploy.md`, `docs/secrets.md`, `docs/backups.md`, `docs/scaling.md` — ops playbooks (apply across products).

The bundled docs match installed versions — trust them over recall.
