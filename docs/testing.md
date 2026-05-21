# Testing

How we test slices (Vitest + PGLite) and full user journeys (Playwright).

## The pyramid

- **Unit (Vitest + PGLite, co-located).** Per use-case; runs in Node; hits a real Postgres-compatible database. ~100 ms per test once WASM is warm. Lives next to the code: `src/features/<slice>/<slice>.test.ts`.
- **Slice E2E (Playwright, co-located).** Browser-driven specs scoped to one capability of one slice. Lives at `src/features/<slice>/e2e/<capability>.spec.ts`.
- **Cross-slice journeys (Playwright).** User flows that span multiple slices. Lives at `products/menu/tests/e2e/journeys/<flow>.spec.ts`.

No "mock all the things and assert call shapes" tier in between. PGLite tests already exercise real Drizzle queries against real Postgres semantics — the layer that would live there would just duplicate them with worse ergonomics.

## Which package owns which tier

| Location | Runner | Tier | Notes |
|---|---|---|---|
| `products/menu/src/**/*.test.ts` | Vitest | unit | PGLite via `src/shared/testing/pglite.ts`; some tests boot real Redis via testcontainers (rate-limit) |
| `products/menu/src/features/*/e2e/` | Playwright | slice e2e | Postgres 18 + adobe/s3mock as service containers in CI (LocalStack locally); one slice per folder |
| `products/menu/tests/e2e/journeys/` | Playwright | cross-slice journeys | Same runtime — only files that span ≥2 slices live here |
| `packages/iedora-identity/src/__tests__/*.test.ts` | Vitest | unit | No DB. Pure crypto + parsing |
| `packages/iedora-observability/src/__tests__/*.test.ts` | Vitest | unit | No-op-in-tests contract, tenant attribute pins |
| `packages/design-system/src/test/` | Vitest + jsdom | unit | Component primitives via Testing Library |

## The PGLite fixture

`products/menu/src/shared/testing/pglite.ts`:

```ts
export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema, casing: 'snake_case' })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { client, db, cleanup: async () => client.close() }
}
```

Applies every Drizzle migration in `./drizzle`, then hands back a Drizzle client wired exactly like production. PGLite is real Postgres semantics — JSON, indexes, transactions, `onConflictDoNothing`, `pg_advisory_xact_lock` — all work.

Vitest is configured with `pool: 'forks'` so each worker owns its PGLite instance; tests can't see each other's data.

## How to write a slice unit test

Template: `products/menu/src/features/auth/auth.test.ts`.

**1. Mock the Next request-scoped APIs.** `redirect()` and `notFound()` only work inside a Next request scope; `server-only` throws at import outside one.

```ts
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`__REDIRECT__:${path}`) }),
  notFound: vi.fn(() => { throw new Error('__NOT_FOUND__') }),
}))
vi.mock('server-only', () => ({}))
```

**2. Fresh DB per test.**

```ts
let t: TestDb
beforeEach(async () => { t = await makeTestDb() })
afterEach(async () => { await t.cleanup() })
```

**3. Seed via Drizzle directly.** No factory helpers — explicit values make tests readable.

```ts
await t.db.insert(schema.user).values({
  id: 'u1', email: 'a@b.test', name: 'A', emailVerified: true,
})
await t.db.insert(schema.organization).values({
  id: 'o1', name: 'Org One', slug: 'org-one', plan: 'free', createdAt: new Date(),
})
```

**4. Build a real port adapter against the test DB.** The use-case sees the same query shape it would in production; only the Postgres swaps.

```ts
const gw: AuthGateway = {
  async getSession() { return session },
  async findRestaurantByIdInOrg({ restaurantId, organizationId, userId }) {
    const rows = await t.db.select(...).from(...).where(...).limit(1)
    return rows[0] ?? null
  },
}
```

Do NOT hand-roll stubs that return hard-coded objects. Wire the adapter to the test DB so the test exercises the same join logic as production.

**5. Assert.**

```ts
await expect(verifySession(gw)).rejects.toThrow('__REDIRECT__:/login')
await expect(requireRestaurantAccess(gw, 'r1')).resolves.toMatchObject({
  restaurantId: 'r1', organizationId: 'o1',
})
```

## E2E architecture — vertical slice, strict

Two homes for specs, and only two:

```
products/menu/
  src/features/<slice>/
    e2e/                          slice-local specs (one capability per file)
    testing/                      slice's public test surface (server-only)
      profile.ts                  permission profile derived from ../scopes
      seeds.ts                    domain seeds returning generated IDs
      routes.ts                   URL constants this slice owns
      index.ts                    barrel
      README.md
  tests/e2e/
    _bootstrap.ts                 Zitadel mock (OIDC discovery + mgmt subset)
    fixtures.ts                   pageErrors + resetMenu + signedInPage + signIn
    global-setup.ts               truncate the test DB
    global-teardown.ts            close DB pool
    helpers/server-only-stub.ts   tsconfig path target — leave alone
    journeys/                     cross-slice user journeys
```

`tests/e2e/helpers/` is **zero-domain** (just the `server-only` stub today; future LocalStack/beacon helpers live under `src/shared/testing/`).

### The `testing/` contract (rule 15)

Every slice exposes:

```ts
// profile.ts — declare intent, never hard-code scope strings
export const fooProfile: PermissionProfile = {
  roles: [IEDORA_ADMIN_ROLE],
  permissions: ALL_SCOPES,        // derived from ../scopes.ts
}
// seeds.ts — idempotent, return the generated IDs
export async function seedFoo(input: FooInput): Promise<SeededFoo> { ... }
// routes.ts — single source of truth for this slice's URLs
export const fooRoutes = { home: '/dashboard/foo' } as const
// index.ts
import 'server-only'
export * from './profile'; export * from './seeds'; export * from './routes'
```

Only `*/e2e/*.spec.ts` and `tests/e2e/journeys/*.spec.ts` may import `testing/`. The ESLint config (`no-restricted-imports`) blocks production paths.

### Slice spec template

```ts
// src/features/menu-builder/e2e/reorder.spec.ts
import { test, expect } from '../../../../tests/e2e/fixtures'
import { menuBuilderProfile, menuBuilderRoutes, seedMenu, seedCategory } from '../testing'
import { seedOrg, bindUserToOrg } from '@/features/identity/testing'
import { seedRestaurant } from '@/features/restaurant-identity/testing'

test.describe('@smoke menu-builder reorder', () => {
  test('drag a category up renumbers positions', async ({ signIn }) => {
    const org = seedOrg({ id: 'org-reorder' })
    const { page, user } = await signIn({
      email: 'b@iedora.test', name: 'B',
      profile: menuBuilderProfile, organizationId: org.organizationId,
    })
    await bindUserToOrg(user.userId, org)
    const r = await seedRestaurant({ organizationId: org.organizationId, name: 'X', slug: 'x' })
    const m = await seedMenu(r.restaurantId)
    await seedCategory(m.menuId, r.restaurantId, { name: 'A', position: 0 })
    await seedCategory(m.menuId, r.restaurantId, { name: 'B', position: 1 })

    await page.goto(menuBuilderRoutes.builder(r.slug, m.menuId))
    // ... drag/drop assertions ...
  })
})
```

### Multi-tenant pattern

Use `bindUserToOrg(userId, org)` from `@/features/identity/testing` to register the mapping with the Zitadel mock. Two users + two orgs is the canonical tenant-isolation setup — see `tests/e2e/journeys/tenant-isolation.spec.ts`.

### Tags

Convention in `test.describe` titles:

| Tag | Meaning | When CI runs it |
|---|---|---|
| `@critical` | tenancy, auth, billing | always |
| `@smoke` | happy path for a slice | always |
| `@journey` | cross-slice flow | always |
| `@flaky` | quarantined | excluded from PR runs |
| `@slow` | >10s typical | nightly only |

Select with `bun run test:e2e -- --grep "@critical"` or `--grep-invert "@flaky"`.

### Running

```bash
cd products/menu
bun run test:e2e            # builds + starts production server, then runs
bun run test:e2e:ui         # Playwright UI mode
bun run test:e2e:debug      # PWDEBUG=1
```

`playwright.config.ts` skips its own build when `CI=true`. `testMatch` is two globs:
`src/features/*/e2e/**/*.spec.ts` + `tests/e2e/journeys/**/*.spec.ts`.

### Database isolation

`tests/e2e/global-setup.ts` truncates the schema. Today the suite runs `workers: 1` against a single `menu_test` DB. The per-worker fork infrastructure is wired (`src/shared/testing/e2e-db.ts::workerDatabaseUrl`) and engaged by `MENU_TEST_ISOLATE_WORKERS=1` once spec volume justifies sharding.

## CI integration

One workflow per workspace. Each `paths:`-filtered.

```
.github/
  actions/setup/action.yml      composite: Bun + bun install --frozen-lockfile
  workflows/
    menu.yml                     menu's full pipeline
    design-system.yml            @iedora/design-system
    identity.yml                 @iedora/identity
    observability.yml            @iedora/observability
```

**`menu.yml` jobs** (parallel except e2e):

- **Typecheck** — `bun run typecheck`. ~2 min.
- **Lint** — `bun run lint`. ~2 min.
- **Unit (Vitest)** — `bun run test`. Docker available so testcontainers can boot Redis. ~3 min.
- **E2E (Playwright)** — `needs: [typecheck, lint, unit]`. Postgres 18 + adobe/s3mock as service containers (LocalStack `:latest` started requiring a paid licence in 2026 — adobe/s3mock is the open-source replacement). Shard matrix is parked at `1/1` today — bump to `[1/2, 2/2]` (or 4) when the suite grows past ~10 min. The infra (per-worker DB fork) is already in place.

The composite action `.github/actions/setup` installs Bun + runs `bun install --frozen-lockfile`. Every job that needs deps is one line: `uses: ./.github/actions/setup`.

Branch protection is deliberately off — solo, AI-driven; CI is the signal.

## Iterating on a CI failure — the local loop

**Don't iterate on CI.** Most CI failures aren't CI-specific — the same command runs the same way locally. A four-commit `fix(ci): try again` chain is avoidable; `bun run test:e2e` reproduces most issues deterministically in 30s.

Iteration ladder, fastest first:

1. **Local repro** — run the literal failing command:
   ```
   cd products/<workspace>
   docker compose up -d        # only if Postgres / LocalStack needed
   bun run <script>
   ```
   For flake hunting: `--repeat-each=N --workers=M` surfaces timing races faster than any CI run.

2. **`gh workflow run`** — re-trigger the real hosted runner without a new commit. Every workflow has `workflow_dispatch:` wired.
   ```
   gh workflow run menu.yml --ref <branch>
   ```

3. **Draft PR on a feature branch** — final integration check before merge.

Don't reach for `nektos/act` for test-logic failures — it can't reproduce the Postgres + LocalStack stack faithfully. Useful only for YAML / matrix / paths-filter shape checks.

## What we don't test (and why)

- **Server Components in jsdom.** They need a Next request scope; jsdom can't supply one. Test via Playwright.
- **Drizzle queries with mocked Drizzle.** The point of PGLite is that you don't have to.
- **Server actions directly.** Orchestration shells (auth guard → use-case → revalidate). The use-case is the unit-tested seam; the action's behaviour is covered end-to-end by Playwright.
- **`openid-client` / `jose` internals.** They have their own conformance + test suites in `node_modules/`. We test what WE wrote on top — the auth slice's port + use-cases.
- **UI styling.** Visual review is a human step.
- **Internal slice plumbing.** Test through the public API of the slice.

See [`architecture.md`](architecture.md) for slice layout, [`AGENTS.md`](../AGENTS.md) for hard rules.
