// Applies Drizzle migrations in production without drizzle-kit at runtime.
// Runs inside the production container via:  node scripts/migrate.mjs
//
// Genkan and menu SHARE the same Postgres SERVER (the `meta-menu-postgres`
// accessory) but each uses its own DATABASE. genkan owns the `genkan`
// database; menu owns `metamenu`. Postgres prevents cross-database queries
// at the server level, so the "no coupling" guarantee holds despite the
// shared process.
//
// On first boot the `genkan` database doesn't exist yet — we connect to
// the admin `postgres` database, CREATE it, then continue normally.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

// pg advisory lock guards against parallel migrates. CRC32 of "genkan-migrate".
const LOCK_KEY = 411073872

/**
 * Parse a postgres URL and return a sibling URL pointing at the admin
 * `postgres` database on the same server — for the one-shot CREATE DATABASE.
 */
function adminUrlFor(connStr) {
  const u = new URL(connStr)
  u.pathname = '/postgres'
  return u.toString()
}

/** Extract the target database name from a postgres URL. */
function dbNameFromUrl(connStr) {
  const u = new URL(connStr)
  return decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres'
}

const targetDb = dbNameFromUrl(url)

// Step 1 — ensure the target database exists. Connect to the admin DB,
// check pg_database, CREATE if missing. Single-shot connection.
{
  const adminSql = postgres(adminUrlFor(url), { max: 1, onnotice: () => {} })
  try {
    const rows = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`
    if (rows.length === 0) {
      console.log(`Database "${targetDb}" not found — creating ...`)
      // CREATE DATABASE doesn't run inside a transaction; postgres.js sends
      // it as a top-level statement. Tag-literal injection is safe because
      // pg_quote_ident escapes the identifier.
      await adminSql.unsafe(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`)
      console.log(`Created database "${targetDb}".`)
    } else {
      console.log(`Database "${targetDb}" already exists.`)
    }
  } finally {
    await adminSql.end()
  }
}

// Step 2 — connect to the target database, hold an advisory lock, migrate.
const sql = postgres(url, { max: 1 })
const db = drizzle(sql)

try {
  console.log(`Acquiring advisory lock (${LOCK_KEY})...`)
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`

  console.log('Applying migrations from ./drizzle ...')
  await migrate(db, {
    migrationsFolder: './drizzle',
    migrationsTable: '__drizzle_migrations',
  })
  console.log('Migrations applied successfully.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exitCode = 1
} finally {
  try { await sql`SELECT pg_advisory_unlock(${LOCK_KEY})` } catch {}
  await sql.end()
}
