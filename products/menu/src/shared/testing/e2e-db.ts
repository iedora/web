import 'server-only'
import postgres, { type Sql } from 'postgres'

/**
 * Zero-domain Postgres helpers for the menu E2E suite. Nothing here knows
 * what `restaurant` or `daily_view` means — every domain seed lives in the
 * owning slice's `testing/seeds.ts`. The only Postgres-level knowledge
 * encoded here is the schema name (`menu`), and `truncateAll` derives the
 * table list from `pg_tables` so a newly-added table does not silently
 * skip cleanup.
 *
 * Imported by:
 *   - every slice's `testing/seeds.ts`
 *   - `tests/e2e/fixtures.ts` (resetMenu fixture)
 *   - `tests/e2e/global-{setup,teardown}.ts`
 *   - cross-slice journeys under `tests/e2e/journeys/`
 */

const DEFAULT_URL =
  'postgresql://postgres:Password1!@localhost:5432/menu_test'

const SCHEMA = 'menu'

/**
 * URL of the database the current worker should use. Today every worker
 * targets the same DB (Playwright runs `workers: 1`); the per-worker
 * suffix is wired in so Phase 3 sharding can flip on by setting
 * `MENU_TEST_ISOLATE_WORKERS=1` without touching slice seeds.
 */
export function workerDatabaseUrl(workerIndex = 0): string {
  const base = process.env.DATABASE_URL ?? DEFAULT_URL
  if (process.env.MENU_TEST_ISOLATE_WORKERS !== '1') return base
  const u = new URL(base)
  u.pathname = `/menu_test_w${workerIndex}`
  return u.toString()
}

let _sql: Sql | null = null

export function testDb(): Sql {
  if (!_sql) _sql = postgres(workerDatabaseUrl(workerIndexFromEnv()), { max: 4 })
  return _sql
}

export async function closeTestDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 })
    _sql = null
  }
}

/**
 * Truncate every table under the `menu` schema. The table list is
 * discovered at runtime, so adding a new table to the schema does not
 * require touching this helper — a common source of "tests pass because
 * the new table was never cleared" bugs.
 */
export async function truncateAll(sql: Sql = testDb()): Promise<void> {
  const rows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = ${SCHEMA}
  `
  if (rows.length === 0) return
  const idents = rows.map((r) => `"${SCHEMA}"."${r.tablename}"`).join(', ')
  await sql.unsafe(`TRUNCATE TABLE ${idents} RESTART IDENTITY CASCADE`)
}

function workerIndexFromEnv(): number {
  const raw = process.env.TEST_WORKER_INDEX
  if (!raw) return 0
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
