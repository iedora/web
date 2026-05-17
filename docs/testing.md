# Testing — across the monorepo

> One-line purpose: how we test slices (Vitest + PGLite), full user
> journeys (Playwright), and Better Auth integrations
> (`@iedora/auth-testkit`).
> **Last updated:** 2026-05.

## The pyramid

Three tiers — the auth-testkit "integration" tier was added when
genkan started consuming an OAuth provider in earnest. Before
that we only ran two.

- **Unit (Vitest + PGLite, co-located).** Per use-case; runs in
  Node; hits a real Postgres-compatible database. Fast (~100 ms
  per test once WASM is warm). Lives next to the code it tests:
  `src/features/<slice>/<slice>.test.ts` (menu) or
  `src/features/<slice>/__tests__/<verb>.test.ts` (genkan).
- **Integration (Vitest + `@iedora/auth-testkit`).** Boots a real
  Better Auth + OAuth-provider instance against PGLite in
  ~150ms and walks actual OIDC / signed-token flows. Used by
  genkan slices whose correctness depends on Better Auth's
  internals (impersonation, JWKS rotation, fresh-session marker)
  and by menu's e2e suite as its OIDC counterparty.
- **End-to-end (Playwright).** Browser-driven journeys through
  the real Next.js menu server. Menu only — genkan has no
  Playwright suite (see "What we don't test" below). Specs in
  `products/menu/tests/e2e/specs/<module>/`.

There is no separate "mock all the things and assert call shapes"
tier between unit and integration. The PGLite unit tests already
exercise real Drizzle queries against real Postgres semantics, so
the layer that used to live there would just duplicate them with
worse ergonomics.

## Which package owns which tier

| Location | Runner | Tier | Notes |
|---|---|---|---|
| `products/menu/src/**/*.test.ts` | Vitest | unit | PGLite via `src/shared/testing/pglite.ts`; some tests boot real Redis via testcontainers (rate-limit) |
| `products/menu/tests/e2e/specs/` | Playwright | e2e | Postgres 18 + LocalStack + an auth-testkit shim genkan on `SHIM_PORT` |
| `products/genkan/src/features/<slice>/<slice>.test.ts` | Vitest | unit | PGLite via the local `shared/testing/pglite.ts` |
| `products/genkan/src/features/<slice>/__tests__/<verb>.test.ts` | Vitest | unit + integration | The ones in `auth/__tests__/` boot the auth-testkit |
| `packages/iedora-identity/src/__tests__/*.test.ts` | Vitest | unit | No DB. Pure crypto + parsing (signature, ssrf, sender, receiver, secret-storage) |
| `packages/iedora-auth-testkit/src/__tests__/*.test.ts` | Vitest | integration | The testkit's own smoke/handshake/seed tests — boots itself |
| `packages/design-system/src/test/` | Vitest + jsdom | unit | Component primitives via Testing Library |

## The PGLite fixture

Both products ship a near-identical `makeTestDb()` at
`src/shared/testing/pglite.ts`:

```ts
export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema, casing: 'snake_case' })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { client, db, cleanup: async () => client.close() }
}
```

It applies every Drizzle migration in the product's `./drizzle`
folder, then hands back a Drizzle client wired exactly like
production (`casing: 'snake_case'` mirrors each
`drizzle.config.ts`). PGLite is real Postgres semantics — JSON,
indexes, transactions, `onConflictDoNothing`, advisory locks
(`pg_advisory_xact_lock` — used by genkan's audit chain and
JWKS rotation) — all work.

Vitest is configured (`vitest.config.ts`) with `pool: 'forks'`
so each worker owns its PGLite instance; tests can't see each
other's data.

## The auth-testkit fixture

`@iedora/auth-testkit` adds a layer above PGLite: an actual
Better Auth + `@better-auth/oauth-provider` instance, listening
on `node:http` on a random local port, with genkan's migrations
applied. Same Better Auth code that runs in production, just
configured for tests.

When to reach for it:

- The test exercises the **OAuth handshake itself** — e.g. menu's
  e2e suite needs to redirect to a real `/authorize`, get a
  code back, exchange it at `/token`, and end up with a session
  row in menu's DB.
- The test exercises a Better Auth **plugin's internal state
  machine** — e.g. impersonation
  (`products/genkan/src/features/auth/__tests__/impersonation.test.ts`)
  reads back the `session.impersonatedBy` column the admin
  plugin sets, and asserts that a `user.impersonate` audit row
  exists BEFORE the cookie flip.
- The test verifies a **signed-token verification path** without
  walking the full handshake — call
  `signTestToken({ handle, userId, scopes })` to get a JWT
  signed by the test instance's JWKS, then hit the service's
  protected route with `Authorization: Bearer ${token}`. The
  consumer verifies against `handle.discoveryUrl`, which serves
  the public JWKS.

When NOT to reach for it:

- The test is **about the use-case's domain logic**, not Better
  Auth's. Use PGLite directly and stub the auth gateway port.
  That's the entire point of having a port.
- The test asserts **rate-limiting or session-cookie domain
  rules** that only show up in real Better Auth — those go in
  `__tests__/` and DO boot the testkit. The
  `role-escalation.test.ts` is the canonical example: it POSTs
  to `/api/auth/sign-up/email` with a `role: 'admin'` field in
  the body and asserts the field is silently dropped (because
  the user `additionalFields.role` has `input: false`).

Two pitfalls to know up front (both have bitten us):

- **`localhost` and `127.0.0.1` are distinct origins to the
  browser AND to Better Auth's cookie code.** If the testkit
  binds to `http://localhost:PORT` and the consumer's
  `BETTER_AUTH_URL` is `http://127.0.0.1:PORT`, set-cookie
  silently fails. Pin both ends to `127.0.0.1` in CI — the e2e
  job does this via job-level env (`NEXT_PUBLIC_GENKAN_URL`
  and `GENKAN_ISSUER_URL`).
- **Better Auth's impersonate flow deletes the session cookie
  and then sets a new one in a single response.** Browsers and
  fetch agents honour this; some HTTP clients eat the
  `Set-Cookie: …; Max-Age=0` and only keep the new value. If
  your integration test misses the impersonation step, switch
  to walking the response cookies in order.

## How to write a slice unit test

Template: `products/menu/src/features/auth/auth.test.ts` (menu) or
`products/genkan/src/features/audit/__tests__/chain.test.ts`
(genkan). The shape is the same every time — paths below
parameterise on `<product>` (`menu` or `genkan`).

**1. Mock the Next request-scoped APIs that use-cases call.**
`redirect()` and `notFound()` only work inside a Next request
scope, and `server-only` throws at import outside one.

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

(Genkan has a `src/shared/testing/server-only-stub.ts` you can
alias to via `vitest.config.ts` if the inline mock gets noisy.)

**2. Stand up a fresh DB per test.**

```ts
let t: TestDb
beforeEach(async () => { t = await makeTestDb() })
afterEach(async () => { await t.cleanup() })
```

**3. Seed via Drizzle directly** — no factory helpers, no
fixtures. Explicit values make the test readable in isolation.

```ts
await t.db.insert(schema.user).values({
  id: 'u1', email: 'a@b.test', name: 'A', emailVerified: true,
})
await t.db.insert(schema.organization).values({
  id: 'o1', name: 'Org One', slug: 'org-one', plan: 'free',
  createdAt: new Date(),
})
```

**4. Build a real port adapter against the test DB.** This is the
canonical pattern. The use-case sees the same shape of query it
would in production; the only thing swapped is which Postgres it
talks to.

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

Do NOT use a hand-rolled stub that returns hard-coded objects.
Wire the adapter to the test DB so the test exercises the same
join logic as production.

**5. Assert.** Happy path: the use-case returns the expected
shape. Redirect path: assert it
`.rejects.toThrow('__REDIRECT__:/login')`.

```ts
await expect(verifySession(gw)).rejects.toThrow('__REDIRECT__:/login')
await expect(requireRestaurantAccess(gw, 'r1')).resolves.toMatchObject({
  restaurantId: 'r1', organizationId: 'o1',
})
```

## How to write an auth-testkit integration test

```ts
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { startTestGenkan, signTestToken } from '@iedora/auth-testkit'

let genkan: Awaited<ReturnType<typeof startTestGenkan>>

beforeAll(async () => {
  genkan = await startTestGenkan({
    clients: [{
      client_id: 'test-app',
      client_secret: 't3st',
      redirect_uris: ['http://127.0.0.1:3000/callback'],
    }],
  })
})
afterAll(() => genkan.stop())

it('issues a bearer token that the service verifies', async () => {
  const user = await genkan.seed.user({
    name: 'Eduardo', email: 'eduardo@example.com',
    password: 'correct-horse-battery-staple',
  })
  const token = await signTestToken({
    handle: genkan, userId: user.id, scopes: ['openid', 'menu'],
  })
  const res = await fetch('http://127.0.0.1:3000/api/protected', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(200)
})
```

Two opinionated defaults to keep in mind:

- The testkit pre-registers every entry in `clients` with
  `skipConsent: true` so the OAuth handshake doesn't need a
  user click.
- Each `startTestGenkan()` call is fully isolated. If two
  tests need to share state, share the same `handle` via
  `beforeAll` (above). If they should NOT share state, give
  each test its own handle.

## E2E patterns (menu)

Specs live under
`products/menu/tests/e2e/specs/<module>/<name>.spec.ts`
— current modules: `auth`, `dashboard`, `landing`, `menu-builder`,
`onboarding`, `public-menu`, `settings`, `tenancy`. Roughly 50
specs.

**`tests/e2e/fixtures.ts` is mandatory.** Import `{ test, expect }`
from that file, not `@playwright/test`. The fixture listens for
any uncaught client error or any 5xx response on a document/RSC
payload and fails the test immediately with the real error
message — without it, a server crash shows up ~10s later as a
"locator not found" timeout.

`tests/e2e/helpers/` has shared signup / org / DB utilities. Use
them rather than rolling your own — they're tuned for the auth
rate-limit disable in CI, and they know how to drive the
auth-testkit shim genkan that lives on `SHIM_PORT`.

### Running

```bash
# Local — depends on docker compose services being up
cd products/menu
bun run test:e2e          # builds + starts the production server, then runs
bun run test:e2e:ui       # Playwright UI mode
bun run test:e2e:debug    # PWDEBUG=1
```

`playwright.config.ts` skips its own build step when `CI=true`,
so CI controls the build separately (Node, not Bun — Bun +
`next build` is unstable as of 2026).

### Database

`tests/e2e/global-setup.ts` resets the test DB before each run.
The DB URL comes from `DATABASE_URL` and points to `metamenu_test`.
The CI workflow creates that database explicitly (see
`.github/workflows/ci.yml`).

### Why genkan has no Playwright suite

Genkan's surface is small (login, signup, reauth, consent, the
admin pages). Every page on it is exercised by one of:

- Menu's e2e suite — the auth specs sign up via menu, get bounced
  to the auth-testkit shim genkan, complete the OIDC handshake,
  and land back in menu authenticated. That covers login, signup,
  consent, and the full OIDC round-trip.
- The auth-testkit's own handshake test
  (`packages/iedora-auth-testkit/src/__tests__/handshake.test.ts`)
  walks `/authorize` → `/token` → `/userinfo` end-to-end.
- Genkan's own integration tests under
  `src/features/auth/__tests__/` — impersonation, role
  escalation, fresh-session, JWKS rotation.

Adding a Playwright suite specifically for genkan is on the
TODO list once the admin UI grows enough surface area to justify
the per-PR runtime cost. TODO(genkan-e2e): decide threshold.

## CI integration

CI is structured as **orchestrator + composite action + reusable
workflows** — the standard monorepo shape (see `AGENTS.md` ## CI for
the full breakdown). The pieces:

```
.github/
  actions/setup/action.yml      composite: Bun install at the workspace root
  workflows/
    ci.yml                       orchestrator: paths-filter + per-workspace gating
    _unit.yml                    reusable: ONE Vitest job for ONE workspace
    _e2e.yml                     reusable: menu Playwright suite + owns env literals
```

**Jobs** (each gated on `dorny/paths-filter` outputs so unrelated
changes skip):

- **Typecheck · menu** — `bun run typecheck`. ~2 min.
- **Typecheck · genkan** — `bun run typecheck`. ~2 min.
- **Lint · menu** — `bun run lint`. ~2 min.
- **Unit · menu** — `bun run test`. Docker available so testcontainers can boot real Redis for the rate-limit suite. ~3 min.
- **Unit · genkan** — `bun run test`. PGLite + auth-testkit suites. ~3 min.
- **Unit · `@iedora/identity`** — `bun run test`. No DB; pure crypto + parsing. ~1 min.
- **Unit · `@iedora/auth-testkit`** — `bun run test`. Boots itself; slowest of the unit jobs but still under 30s. ~1 min.
- **E2E (Playwright)** — Postgres 18 + LocalStack as service
  containers. Build runs under Node (`node --run build`); Playwright
  + everything else uses Bun. Caches `.next/cache` (Turbopack
  persistent cache) and `~/.cache/ms-playwright`. ~15-20 min.

`_unit.yml` takes a `workdir` input — every per-workspace job is a
four-line block in `ci.yml`. The Bun install happens once per runner
at the workspace root via the composite action, before `cd`-ing into
the package. Adding a new product = one paths-filter entry + one
reusable-workflow call. No copy-pasted setup.

The e2e job's `if:` uses `!failure() && !cancelled()` instead of
plain `success()` so it still runs when an upstream was skipped
(paths-filter short-circuit). Otherwise a docs-only change to menu
would skip `unit-genkan` → e2e blocked → noise.

Branch protection is deliberately off — solo, AI-driven project;
the CI itself is the signal. Revisit when adding collaborators.

## Cookie-handling pitfalls (auth-testkit specifically)

Save a future-you. We've hit these:

1. **`localhost` vs `127.0.0.1` are distinct hosts.** The
   browser, fetch agents, and Better Auth's cookie code all
   treat them as separate origins. Pin both ends of the
   handshake to the same string. CI uses `127.0.0.1`
   everywhere because Playwright sometimes resolves
   `localhost` to `::1` on the runner, which silently breaks
   the cookie domain match.
2. **Better Auth's impersonate flow returns a single response
   with `Set-Cookie: name=; Max-Age=0` followed by
   `Set-Cookie: name=<new>`.** Some HTTP clients keep only the
   first; you end up with a logged-out fetcher. The
   auth-testkit's integration tests use the live Node fetch,
   which honours the order. If you reach for `node-fetch`
   v2.x in a test, read the cookies yourself.
3. **The auth-testkit applies migrations from a path resolved
   relative to `import.meta.url`.** If you bundle the testkit
   into a dist file, the migration path resolution breaks.
   Always import from source (`@iedora/auth-testkit` →
   `./src/index.ts` via the workspace export map).

## What we don't test (and why)

- **Server Components in jsdom.** They need a Next request
  scope; jsdom can't supply one. Test them via Playwright
  instead.
- **Drizzle queries with mocked Drizzle.** The point of PGLite
  is that you don't have to.
- **Server actions directly.** They're orchestration shells
  (auth guard → use-case → revalidate). The use-case is the
  unit-tested seam; the action's behaviour is covered
  end-to-end by Playwright. Asserting "the action calls
  `revalidateRestaurant('foo')`" is a tautology of the action's
  source.
- **Better Auth's plugin internals.** The `organization`,
  `admin`, `jwt`, and `oauth-provider` plugins have their own
  test suites in `node_modules/better-auth/` and
  `node_modules/@better-auth/oauth-provider/`. We test what
  WE wrote on top — the `requireFreshSession` guard, the audit
  chain, the JWKS rotation cron — not Better Auth's own
  behaviour. The auth-testkit lets us exercise our code
  against a real Better Auth without re-testing it.
- **UI styling.** Visual review is a human step. We don't
  snapshot the design system in CI; the Manual is the source
  of truth and changes go through human eyes.
- **Internal slice plumbing.** Test through the public API of
  the slice (use-cases for unit tests, the rendered route for
  e2e). If you can't reach a code path from the public API,
  it's dead code or the API is wrong.

See [`architecture.md`](architecture.md) for the slice layout and
[`AGENTS.md`](../AGENTS.md) for the menu + genkan hard rules.
