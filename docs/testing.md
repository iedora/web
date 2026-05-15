# Testing — the pyramid

> One-line purpose: how we test slices (Vitest + PGLite) and full user
> journeys (Playwright), with no middle layer.
> **Last updated:** 2026.

## Pyramid

- **Unit (Vitest + PGLite, co-located).** Per use-case; runs in Node;
  hits a real Postgres-compatible database. Fast (<100 ms per test once
  WASM is warm). Live next to the code they test:
  `src/features/<slice>/<slice>.test.ts`.
- **End-to-end (Playwright).** Browser-driven journeys through the real
  Next.js server. Specs in `tests/e2e/specs/<module>/`. ~50 specs across
  12 modules.

There is no intermediate "integration" layer. The PGLite unit tests
already exercise real Drizzle queries against real Postgres semantics, so
a separate integration tier would duplicate them with worse ergonomics.

## The PGLite fixture

`src/shared/testing/pglite.ts` exposes `makeTestDb()`:

```ts
export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema, casing: 'snake_case' })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { client, db, cleanup: async () => client.close() }
}
```

It applies every Drizzle migration in `./drizzle`, then hands back a
Drizzle client wired exactly like production (`casing: 'snake_case'`
mirrors `drizzle.config.ts`). PGLite is real Postgres semantics — JSON,
indexes, transactions, `onConflictDoNothing`, all work.

Vitest is configured (`vitest.config.ts`) with `pool: 'forks'` so each
worker owns its PGLite instance; tests can't see each other's data.

## How to write a slice unit test

Template: `src/features/auth/auth.test.ts`. The shape is the same every time.

**1. Mock the Next request-scoped APIs that use-cases call.** `redirect()`
and `notFound()` only work inside a Next request scope, and `server-only`
throws at import outside one.

```ts
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`__REDIRECT__:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('__NOT_FOUND__')
  }),
}))
vi.mock('server-only', () => ({}))
```

**2. Stand up a fresh DB per test.**

```ts
let t: TestDb
beforeEach(async () => { t = await makeTestDb() })
afterEach(async () => { await t.cleanup() })
```

**3. Seed via Drizzle directly** — no factory helpers, no fixtures.
Explicit values make the test readable in isolation.

```ts
await t.db.insert(schema.user).values({
  id: 'u1', email: 'a@b.test', name: 'A', emailVerified: true,
})
await t.db.insert(schema.organization).values({
  id: 'o1', name: 'Org One', slug: 'org-one', plan: 'free', createdAt: new Date(),
})
```

**4. Build a real port adapter against the test DB.** This is the
canonical pattern. The use-case sees the same shape of query it would in
production; the only thing swapped is which Postgres it talks to.

```ts
const gw: AuthGateway = {
  async getSession() { return session },
  async findRestaurantByIdInOrg({ restaurantId, organizationId, userId }) {
    const rows = await t.db.select(...).from(...).where(...).limit(1)
    return rows[0] ?? null
  },
  // ...other port methods
}
```

Do NOT use a hand-rolled stub that returns hard-coded objects. Wire the
adapter to the test DB so the test exercises the same join logic as
production.

**5. Assert.** Happy path: the use-case returns the expected shape.
Redirect path: assert it `.rejects.toThrow('__REDIRECT__:/login')`.

```ts
await expect(verifySession(gw)).rejects.toThrow('__REDIRECT__:/login')
await expect(requireRestaurantAccess(gw, 'r1')).resolves.toMatchObject({
  restaurantId: 'r1', organizationId: 'o1',
})
```

## The Playwright suite

Specs live under `tests/e2e/specs/<module>/<name>.spec.ts` (auth, billing,
dashboard, landing, menu-builder, metrics, plans, public-menu, qr,
settings, tenancy, uploads).

**`tests/e2e/fixtures.ts` is mandatory.** Import `{ test, expect }` from
that file, not `@playwright/test`. The fixture listens for any uncaught
client error or any 5xx response on a document/RSC payload and fails the
test immediately with the real error message — without it, a server crash
shows up ~10s later as a "locator not found" timeout.

`tests/e2e/helpers/` has shared signup / org / DB utilities. Use them
rather than rolling your own — they're tuned for the auth rate-limit
disable in CI.

### Running

```bash
# Local — depends on docker compose services being up
bun run test:e2e          # builds + starts the production server, then runs
bun run test:e2e:ui       # Playwright UI mode
bun run test:e2e:debug    # PWDEBUG=1
```

`playwright.config.ts` skips its own build step when `CI=true`, so CI
controls the build separately (Node, not Bun — Bun + `next build` is
unstable as of 2026).

### Database

`tests/e2e/global-setup.ts` resets the test DB before each run. The DB
URL comes from `DATABASE_URL` and points to `metamenu_test`. The CI
workflow creates that database explicitly (see `.github/workflows/ci.yml`).

## What NOT to test

- **Server Components in jsdom.** They need a Next request scope; jsdom
  can't supply one. Test them via Playwright instead.
- **Drizzle queries with mocked Drizzle.** The point of PGLite is that you
  don't have to.
- **Internal slice plumbing.** Test through the public API of the slice
  (use-cases for unit tests, the rendered route for e2e). If you can't
  reach a code path from the public API, it's dead code or the API is
  wrong.

## CI

`.github/workflows/ci.yml` runs three jobs on push and PR:

- **Typecheck** and **Lint** (parallel, Bun runtime, ~2-3 minutes each).
- **E2E (Playwright)** gated on the cheap jobs. Postgres 18, Redis 7, and
  LocalStack run as service containers. The Next.js build runs under
  **Node** (`node --run build`); Playwright + everything else uses Bun.
  Caches `.next/cache` (Turbopack persistent cache) and
  `~/.cache/ms-playwright`.

Branch protection is deliberately off — solo, AI-driven project; the CI
itself is the signal. Revisit when adding collaborators.

See [`architecture.md`](architecture.md) for the slice layout, and
[`AGENTS.md`](../AGENTS.md) for the hard rules.
