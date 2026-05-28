// products/menu/migrate.mjs — runtime migrator (menu DB).
// Thin wrapper sobre @iedora/db/migrate (helper canónico em data layer).
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runMigrations } from '../../packages/db/src/migrate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
await runMigrations({
  url: process.env.MENU_DATABASE_URL,
  folder: join(HERE, 'drizzle'),
  tag: 'menu',
})
