// Aplica migrations Drizzle em produção sem precisar de drizzle-kit no runtime.
// Corre no container produção via:  node scripts/migrate.mjs
//
// O `lib/db` da app já importa `drizzle-orm/postgres-js`, portanto o migrator
// vai no bundle standalone do Next.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

// pg advisory lock garante que dois deploys paralelos não migram em duplicado.
// O valor é arbitrário mas tem de ser estável e único — crc32 de "meta-menu-migrate".
const LOCK_KEY = 727072073

const sql = postgres(url, { max: 1 })
const db = drizzle(sql)

try {
  console.log(`Acquiring advisory lock (${LOCK_KEY})...`)
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`

  console.log('Applying migrations from ./drizzle ...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations applied successfully.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exitCode = 1
} finally {
  try { await sql`SELECT pg_advisory_unlock(${LOCK_KEY})` } catch {}
  await sql.end()
}
