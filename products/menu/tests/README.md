# Testing

How we test slices (Vitest + PGLite) and full user journeys (Playwright).

## The pyramid

- **Unit (Vitest + PGLite, co-located).** Per use-case; runs in Node; hits a real Postgres-compatible database. ~100 ms per test once WASM is warm. Lives next to the code: `src/features/<slice>/<slice>.test.ts`.
- **Slice E2E (Playwright, co-located).** Browser-driven specs scoped to one capability of one slice. Lives at `src/features/<slice>/e2e/<capability>.spec.ts`.
- **Cross-slice journeys (Playwright).** User flows that span multiple slices. Lives at `tests/e2e/journeys/<flow>.spec.ts`.

No "mock all the things and assert call shapes" tier in between. PGLite tests already exercise real Drizzle queries against real Postgres semantics — the layer that would live there would just duplicate them with worse ergonomics.

## Which package owns which tier

| Location | Runner | Tier | Notes |
|---|---|---|---|
| `src/**/*.test.ts` | Vitest | unit | PGLite via `src/shared/testing/pglite.ts`; rate-limit also runs against PGLite (advisory locks + `READ COMMITTED`) |
| `src/features/*/e2e/` | Playwright | slice e2e | Postgres 18 + adobe/s3mock as service containers (dev and CI); one slice per folder |
| `tests/e2e/journeys/` | Playwright | cross-slice journeys | Same runtime — only files that span ≥2 slices live here |
| `packages/iedora-observability/src/__tests__/*.test.ts` | Vitest | unit | No-op-in-tests contract, tenant attribute pins |
| `packages/design-system/src/test/` | Vitest + jsdom | unit | Component primitives via Testing Library |

## The PGLite fixture

`src/shared/testing/pglite.ts`:

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

Template: `src/features/auth/auth.test.ts`.

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
apps/web/
  src/features/<slice>/
    e2e/                          slice-local specs (one capability per file)
    testing/                      slice's public test surface (server-only)
      profile.ts                  permission profile derived from ../scopes
      seeds.ts                    domain seeds returning generated IDs
      routes.ts                   URL constants this slice owns
      index.ts                    barrel
      README.md
  tests/e2e/
    fixtures.ts                   pageErrors + resetMenu + signedInPage + signIn
    global-setup.ts               truncate the test DB
    global-teardown.ts            close DB pool
    helpers/server-only-stub.ts   tsconfig path target — leave alone
    journeys/                     cross-slice user journeys
```

> Auth in tests goes through `auth.api.signInEmail` against the test
> DB — better-auth runs in-process, so there's no network IdP to mock
> and no bootstrap server. The fixture + spec patterns below are being
> rebuilt against `@iedora/core-auth`; treat the snippets as historical
> reference until the new harness lands.

`tests/e2e/helpers/` is **zero-domain** (just the `server-only` stub today; future s3mock/beacon helpers live under `src/shared/testing/`).

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
export const fooRoutes = { home: '/menu/dashboard/foo' } as const
// index.ts
import 'server-only'
export * from './profile'; export * from './seeds'; export * from './routes'
```

Only `*/e2e/*.spec.ts` and `tests/e2e/journeys/*.spec.ts` may import `testing/`. The ESLint config (`no-restricted-imports`) blocks production paths.

### Slice spec template

```ts
// src/features/<slice>/e2e/<capability>.spec.ts  (template — replace with real slice)
import { test, expect } from '../../../../tests/e2e/fixtures'
import { menuBuilderProfile, menuBuilderRoutes, seedMenu, seedCategory } from '../testing'
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

Two users + two orgs is the canonical tenant-isolation setup — see `tests/e2e/journeys/tenant-isolation.spec.ts`. TODO(phase-1-sweep): document the better-auth equivalent of `bindUserToOrg` once the new harness lands — likely `auth.api.createOrganization` + `auth.api.addMember` against the test DB inside `signIn()`.

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
cd apps/web
bun run test:e2e            # builds + starts production server, then runs
bun run test:e2e:ui         # Playwright UI mode
bun run test:e2e:debug      # PWDEBUG=1
```

`playwright.config.ts` skips its own build when `CI=true`. `testMatch` is two globs:
`src/features/*/e2e/**/*.spec.ts` + `tests/e2e/journeys/**/*.spec.ts`.

### Database isolation

`tests/e2e/global-setup.ts` truncates the schema. Today the suite runs `workers: 1` against a single `menu_test` DB. The per-worker fork infrastructure is wired (`src/shared/testing/e2e-db.ts::workerDatabaseUrl`) and engaged by `MENU_TEST_ISOLATE_WORKERS=1` once spec volume justifies sharding.

## CI integration

One workflow per workspace. Each `paths:`-filtered. See [`docs/testing/e2e-architecture.md`](../../../docs/testing/e2e-architecture.md) for the cross-product E2E design and the shared composite action.

```
.gitea/
  workflows/
    ci.yml                       3 jobs: ci + audit + deploy (gated)
```

**`ci.yml` jobs**:

- **`ci`** (sequential in one container): typecheck + lint + test (all workspaces). ~7 min.
- **`audit`** (paralelo a `ci`): gitleaks + hadolint + osv-scanner.
- **`deploy`** (push a main, `needs: [ci, audit]`): `kamal deploy -d production`.

E2E is not yet in Gitea Actions (requires Postgres + s3mock as service
containers). Run locally via `bun run test:e2e`.

Branch protection is deliberately off — solo, AI-driven; CI is the signal.

## Iterating on a CI failure — the local loop

**Don't iterate on CI.** Most CI failures aren't CI-specific — the same command runs the same way locally. A four-commit `fix(ci): try again` chain is avoidable; `bun run test:e2e` reproduces most issues deterministically in 30s.

Iteration ladder, fastest first:

1. **Local repro** — run the literal failing command:
   ```
   cd products/<workspace>
   docker compose up -d        # only if Postgres / s3mock needed
   bun run <script>
   ```
   For flake hunting: `--repeat-each=N --workers=M` surfaces timing races faster than any CI run.

2. **Gitea Actions re-run** — re-trigger the workflow from the Gitea UI
   (Actions → workflow → Re-run). Every workflow has `workflow_dispatch:` wired.

3. **Draft PR on a feature branch** — final integration check before merge.

Don't reach for `nektos/act` for test-logic failures — it can't reproduce the Postgres + s3mock stack faithfully. Useful only for YAML / matrix / paths-filter shape checks.

## What we don't test (and why)

- **Server Components in jsdom.** They need a Next request scope; jsdom can't supply one. Test via Playwright.
- **Drizzle queries with mocked Drizzle.** The point of PGLite is that you don't have to.
- **Server actions directly.** Orchestration shells (auth guard → use-case → revalidate). The use-case is the unit-tested seam; the action's behaviour is covered end-to-end by Playwright.
- **`better-auth` internals.** It has its own test suite. We test what WE wrote on top — the menu auth slice's DAL guards + the scope-to-permission mapping in `scopes.ts`.
- **UI styling.** Visual review is a human step.
- **Internal slice plumbing.** Test through the public API of the slice.

See [products/menu/CLAUDE.md](../CLAUDE.md) for slice layout, [AGENTS.md](../../../AGENTS.md) for hard rules.
