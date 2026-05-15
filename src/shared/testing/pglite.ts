import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/shared/db/schema'

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

export interface TestDb {
  client: PGlite
  db: ReturnType<typeof drizzle<typeof schema>>
  /** Closes the in-memory client. Call in afterEach/afterAll. */
  cleanup: () => Promise<void>
}

/**
 * Creates an isolated in-memory Postgres for one test (or one suite, if you
 * want to share it). Applies every migration in ./drizzle, then returns a
 * Drizzle client. PGLite is real Postgres semantics — json, indexes,
 * transactions all work. ~1s for the first call (WASM init), <100ms per
 * subsequent migrate against the same process.
 *
 * The fixture matches the production wiring: `casing: 'snake_case'` mirrors
 * `drizzle.config.ts` so column names resolve identically.
 */
export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema, casing: 'snake_case' })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return {
    client,
    db,
    cleanup: async () => {
      await client.close()
    },
  }
}
