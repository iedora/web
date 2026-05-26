import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: 'snake_case',
  // Each iedora product tracks its own migrations in its own table. Genkan
  // and menu share the same Postgres database; without separating trackers
  // they'd write to the same `drizzle.__drizzle_migrations` and start
  // skipping each other's migrations as "already applied".
  migrations: {
    table: '__drizzle_migrations',
    schema: 'menu',
  },
})
