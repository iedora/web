# Testing

How we test slices (Vitest + PGLite) and full user journeys (Playwright).

## The pyramid

- **Unit (Vitest + PGLite, co-located).** Per use-case; runs in Node; hits a real Postgres-compatible database. ~100 ms per test once WASM is warm. Lives next to the code: `src/features/<slice>/<slice>.test.ts`.
- **End-to-end (Playwright).** Browser-driven journeys through the real Next.js menu server. Specs in `products/menu/tests/e2e/specs/<module>/`.

No "mock all the things and assert call shapes" tier in between. PGLite tests already exercise real Drizzle queries against real Postgres semantics — the layer that would live there would just duplicate them with worse ergonomics.

## Which package owns which tier

| Location | Runner | Tier | Notes |
|---|---|---|---|
| `products/menu/src/**/*.test.ts` | Vitest | unit | PGLite via `src/shared/testing/pglite.ts`; some tests boot real Redis via testcontainers (rate-limit) |
| `products/menu/tests/e2e/specs/` | Playwright | e2e | Postgres 18 + LocalStack as service containers |
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

## E2E patterns

Specs under `products/menu/tests/e2e/specs/<module>/<name>.spec.ts` — current modules: `auth`, `dashboard`, `landing`, `menu-builder`, `onboarding`, `public-menu`, `settings`, `tenancy`. Roughly 50 specs.

**`tests/e2e/fixtures.ts` is mandatory.** Import `{ test, expect }` from that file, not `@playwright/test`. The fixture listens for uncaught client errors or 5xx responses and fails immediately with the real error — without it, a server crash shows up ~10s later as a "locator not found" timeout.

`tests/e2e/helpers/` has shared signup / org / DB utilities.

### Running

```bash
cd products/menu
bun run test:e2e          # builds + starts production server, then runs
bun run test:e2e:ui       # Playwright UI mode
bun run test:e2e:debug    # PWDEBUG=1
```

`playwright.config.ts` skips its own build when `CI=true`, so CI controls the build separately (Node, not Bun — Bun + `next build` is unstable).

### Database

`tests/e2e/global-setup.ts` resets the test DB before each run. `DATABASE_URL` points at `menu_test`; CI creates the DB explicitly.

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
- **E2E (Playwright)** — `needs: [typecheck, lint, unit]`. Postgres 18 + LocalStack as service containers. Build under Node (`node --run build`); Playwright + everything else uses Bun. Caches `.next/cache` and `~/.cache/ms-playwright`. ~15–20 min.

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
- **Better Auth plugin internals.** They have their own test suites in `node_modules/`. We test what WE wrote on top.
- **UI styling.** Visual review is a human step.
- **Internal slice plumbing.** Test through the public API of the slice.

See [`architecture.md`](architecture.md) for slice layout, [`AGENTS.md`](../AGENTS.md) for hard rules.
