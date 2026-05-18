// Applies Drizzle migrations + seeds first-party OAuth clients in production
// without drizzle-kit at runtime. Runs inside the container via:
//   node scripts/migrate.mjs
//
// Database bootstrap is two-layered (matches menu's pattern — see
// products/menu/scripts/migrate.mjs for the full rationale):
//   1. infra/postgres/init.sql creates every known product DB on cold boot.
//   2. The CREATE-IF-NOT-EXISTS block below covers products added later.
//
// pg_advisory_lock guards against two replicas racing on `migrate()` —
// Drizzle still has no built-in migration lock (see drizzle-orm#874).

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { createHash } from 'node:crypto'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const LOCK_KEY = 411073872 // crc32 of "genkan-migrate"

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

  await migrate(db, {
    migrationsFolder: './drizzle',
    migrationsTable: '__drizzle_migrations',
  })
  console.log('Migrations applied.')

  // Bootstrap first-party OAuth clients. Genkan's oauth-provider plugin
  // reads client rows from `oauth_client`; pre-trusted clients
  // (skip_consent=true) are pinned by client_id via `cachedTrustedClients`
  // in the auth config. Upserting here means a fresh deploy comes up
  // with menu (and any sibling product) ready to authorize without
  // a manual step.
  //
  // TRUSTED_CLIENTS format: one line per client,
  //   `client_id|client_secret|redirect_uri_1,redirect_uri_2`
  const raw = process.env.TRUSTED_CLIENTS ?? ''
  const entries = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of entries) {
    const [clientId, clientSecret, redirectUris] = line.split('|')
    if (!clientId || !clientSecret || !redirectUris) {
      console.warn(`Skipping malformed TRUSTED_CLIENTS entry: ${line}`)
      continue
    }
    const uris = redirectUris.split(',').map((u) => u.trim())
    // Better Auth hashes secrets with SHA-256 + base64url (no padding)
    // before storing. Match the algorithm so runtime checks pass.
    const hashed = createHash('sha256').update(clientSecret, 'utf8').digest('base64url')
    // Stable id derived from client_id keeps re-runs idempotent.
    const id = `tc_${clientId}`
    await sql`
      INSERT INTO oauth_client (
        id, client_id, client_secret, name, redirect_uris,
        scopes, skip_consent, disabled, public, require_pkce,
        token_endpoint_auth_method, grant_types, response_types,
        subject_type, type, created_at, updated_at
      ) VALUES (
        ${id}, ${clientId}, ${hashed}, ${clientId}, ${uris},
        ${['openid','profile','email','offline_access','menu','org:read','org:admin']},
        true, false, false, true,
        'client_secret_basic',
        ${['authorization_code','refresh_token']},
        ${['code']},
        'public', 'web', NOW(), NOW()
      )
      ON CONFLICT (client_id) DO UPDATE SET
        client_secret = EXCLUDED.client_secret,
        redirect_uris = EXCLUDED.redirect_uris,
        skip_consent  = EXCLUDED.skip_consent,
        updated_at    = NOW()
    `
    console.log(`Seeded trusted client: ${clientId}`)
  }
} catch (err) {
  console.error('Migration failed:', err)
  process.exitCode = 1
} finally {
  try { await sql`SELECT pg_advisory_unlock(${LOCK_KEY})` } catch {}
  await sql.end()
}
