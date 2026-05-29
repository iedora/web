// packages/core-auth/migrate.mjs — runtime migrator (core DB).
// Thin wrapper sobre @iedora/db/migrate (helper canónico em data layer).
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runMigrations } from '../db/src/migrate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
await runMigrations({
  url: process.env.CORE_DATABASE_URL,
  folder: join(HERE, 'drizzle'),
  tag: 'core',
})
