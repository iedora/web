/**
 * Applies @iedora/core-auth's Drizzle migrations against the `core` Postgres
 * database. Runs in three places:
 *
 *   1. CI — apps/web/scripts/migrate-test.mjs spawns it before the e2e
 *      build, against the ephemeral postgres service container.
 *   2. local dev — bin/dev-stack step 2 runs it after `docker compose up`.
 *   3. prod — Stage 3 of the deploy pipeline (`bin/iedora app`) runs it
 *      against the Hetzner Postgres before the app container hot-swap.
 *
 * Real work lives in @iedora/db/scripts/run-migrations — this file is
 * the thin per-product entrypoint that picks the env var, computes the
 * migrations folder path, and supplies the schema + lock name. Mirror
 * its shape when adding a new product (see products/menu/scripts/migrate.mjs
 * + products/imopush/scripts/migrate.mjs).
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runMigrations } from '@iedora/db/scripts/run-migrations'

const url = process.env.CORE_DATABASE_URL
if (!url) {
  console.error('CORE_DATABASE_URL is not set')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))

try {
  await runMigrations({
    databaseUrl: url,
    migrationsFolder: join(here, '..', 'drizzle'),
    migrationsSchema: 'core',
    lockName: 'iedora-core-migrate',
    label: 'core',
  })
} catch (err) {
  console.error('[migrate:core] failed:', err)
  process.exit(1)
}
