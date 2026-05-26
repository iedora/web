// Applies Drizzle migrations in production without drizzle-kit at runtime.
// Runs inside the container via:  node scripts/migrate.mjs
//
// Database bootstrap is two-layered for defense in depth:
//   1. infra/postgres/init.sql runs ONCE on the very first boot of the
//      shared infra-postgres accessory and creates every known product DB.
//      Fast path for cold deploys.
//   2. The CREATE-IF-NOT-EXISTS block below covers the case where this
//      product was added AFTER infra-postgres already had a populated
//      data dir (when adding a 3rd product later, no one has to wipe the
//      volume). It's a single round-trip when the DB exists; only
//      meaningful work on the very first deploy of a new product.
//
// pg_advisory_lock guards against two replicas racing on `migrate()` —
// Drizzle still has no built-in migration lock (see drizzle-orm#874).
// The literal "meta-menu-migrate" feeds the crc32 → keep stable across
// renames so the key doesn't shift between deploys.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const LOCK_KEY = 727072073 // crc32 of "meta-menu-migrate"

function adminUrlFor(connStr) {
  const u = new URL(connStr)
  u.pathname = '/postgres'
  return u.toString()
}

function dbNameFromUrl(connStr) {
  const u = new URL(connStr)
  return decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres'
}

// Ensure the target DB exists. Idempotent on every deploy after the first.
{
  const targetDb = dbNameFromUrl(url)
  const adminSql = postgres(adminUrlFor(url), { max: 1, onnotice: () => {} })
  try {
    const rows = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`
    if (rows.length === 0) {
      // CREATE DATABASE can't run in a transaction; postgres.js sends it
      // as a top-level statement. Identifier escaping protects the value.
      await adminSql.unsafe(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`)
      console.log(`Created database "${targetDb}".`)
    }
  } finally {
    await adminSql.end()
  }
}

const sql = postgres(url, { max: 1 })
const db = drizzle(sql)

try {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
  // Per-product tracker — see drizzle.config.ts. Without this, menu and
  // any future product sharing the database would write into the same
  // `drizzle.__drizzle_migrations` and shadow each other (the migrator
  // only applies entries newer than max(created_at)).
  await migrate(db, {
    migrationsFolder: './drizzle',
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'menu',
  })
  console.log('Migrations applied.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exitCode = 1
} finally {
  try { await sql`SELECT pg_advisory_unlock(${LOCK_KEY})` } catch {}
  await sql.end()
}
