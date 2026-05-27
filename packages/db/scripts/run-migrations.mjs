/**
 * Generic Drizzle migration runner — the only path every product should
 * use to apply migrations, in any environment (dev, CI, prod).
 *
 * Why not `drizzle-kit migrate` directly:
 *   - It swallows errors. A schema collision exits 1 with no output;
 *     a connection drop looks identical to a SQL syntax error.
 *   - It has no hook for advisory locks. Two replicas racing on migrate()
 *     corrupt `__drizzle_migrations` without one (drizzle-orm#874).
 *   - It runs as a subprocess, so observability + logging are surface-level.
 *
 * This helper:
 *   1. Ensures the target database exists (CREATE DATABASE IF NOT EXISTS
 *      via the postgres admin DB). Idempotent.
 *   2. Pre-creates the target pg-schema (CREATE SCHEMA IF NOT EXISTS).
 *      This sidesteps the drizzle-kit 0.31+ behaviour where the
 *      migration's `CREATE SCHEMA <name>` clashes with the schema
 *      drizzle-kit pre-creates for its own `__drizzle_migrations` table.
 *   3. Acquires a `pg_advisory_lock` keyed on a crc32 of `lockName`.
 *      Two concurrent migrate runs on different replicas wait on the
 *      lock instead of corrupting state.
 *   4. Runs drizzle's programmatic `migrate()` with the supplied folder.
 *   5. Releases the lock + closes the connection.
 *
 * Throws (rejects) on any failure with the original error preserved —
 * callers should let the rejection propagate so the process exits 1
 * with a useful stack trace. Never swallow.
 *
 * Observability: this helper deliberately stays @iedora/observability-free.
 * @vercel/otel's `registerOTel` doesn't bundle cleanly into a standalone
 * distroless-node script via `bun build` (TDZ violation on BasicTracer
 * init, seen in dev). The migrate container's stdout is captured by the
 * runtime collector (fluentbit → OpenObserve) so log lines already land
 * in OO; the missing piece — spans + duration metrics around each
 * `docker run` — belongs in the parent orchestrator (`iedora local
 * migrate` / Stage 3 configurators) where the @opentelemetry/sdk-node
 * setup is unconstrained by the migrate image's distroless runtime.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * crc32 of an ASCII string. Tiny implementation to avoid a runtime
 * dependency on Node 22.5+'s `zlib.crc32`. Result is an unsigned 32-bit
 * integer used directly as a Postgres advisory-lock key.
 */
function crc32(str) {
  let crc = 0xffffffff
  for (let i = 0; i < str.length; i++) {
    crc = crc ^ str.charCodeAt(i)
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adminUrlFor(connStr) {
  const u = new URL(connStr)
  u.pathname = '/postgres'
  return u.toString()
}

function dbNameFromUrl(connStr) {
  const u = new URL(connStr)
  return decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres'
}

async function ensureDatabase(connStr, log) {
  const targetDb = dbNameFromUrl(connStr)
  const adminSql = postgres(adminUrlFor(connStr), {
    max: 1,
    onnotice: () => {},
  })
  try {
    const rows = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`
    if (rows.length === 0) {
      await adminSql.unsafe(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`)
      log(`created database "${targetDb}"`)
    }
  } finally {
    await adminSql.end()
  }
}

async function ensureSchema(sql, schemaName, log) {
  const safe = schemaName.replace(/"/g, '""')
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${safe}"`)
  log(`ensured schema "${schemaName}"`)
}

/**
 * @param {object} opts
 * @param {string} opts.databaseUrl     - Postgres connection string. Must include a DB name in the path.
 * @param {string} opts.migrationsFolder - Absolute path to the drizzle/ folder.
 * @param {string} opts.migrationsSchema - pg-schema where `__drizzle_migrations` lives. Usually the product's schema.
 * @param {string} opts.lockName         - Stable identifier used to derive the advisory-lock key. Convention: `iedora-<product>-migrate`.
 * @param {string} [opts.migrationsTable] - Defaults to `__drizzle_migrations`.
 * @param {string} [opts.label]          - Prefix used for stdout log lines. Defaults to migrationsSchema.
 */
export async function runMigrations({
  databaseUrl,
  migrationsFolder,
  migrationsSchema,
  lockName,
  migrationsTable = '__drizzle_migrations',
  label = migrationsSchema,
}) {
  if (!databaseUrl) throw new Error('runMigrations: databaseUrl is required')
  if (!migrationsFolder) throw new Error('runMigrations: migrationsFolder is required')
  if (!migrationsSchema) throw new Error('runMigrations: migrationsSchema is required')
  if (!lockName) throw new Error('runMigrations: lockName is required')

  const lockKey = crc32(lockName)
  const log = (msg) => console.log(`[migrate:${label}] ${msg}`)
  const startedAt = Date.now()

  log(`target database "${dbNameFromUrl(databaseUrl)}"`)

  await ensureDatabase(databaseUrl, log)

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  const db = drizzle(sql)

  let locked = false
  try {
    await ensureSchema(sql, migrationsSchema, log)

    await sql`SELECT pg_advisory_lock(${lockKey})`
    locked = true
    log(`acquired advisory lock (key=${lockKey}, name="${lockName}")`)

    await migrate(db, {
      migrationsFolder,
      migrationsTable,
      migrationsSchema,
    })
    const elapsed = Date.now() - startedAt
    log(`migrations applied (${elapsed}ms)`)
  } finally {
    if (locked) {
      try {
        await sql`SELECT pg_advisory_unlock(${lockKey})`
      } catch (err) {
        log(`warning: unlock failed: ${err?.message ?? err}`)
      }
    }
    await sql.end()
  }
}
