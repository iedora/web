import { defineConfig } from 'drizzle-kit'

/**
 * Migrations for the `core` database — Postgres schema `core`. Owns the
 * better-auth tables today; the (future) core product will add audit +
 * admin tables under the same schema.
 *
 * Run via:
 *   bun run db:generate    (after editing src/schema.ts)
 *   bun run db:migrate     (applies pending migrations)
 *
 * Stage 3 of the deploy pipeline runs `db:migrate` against the prod
 * `core` database (see infra/app-state).
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['core'],
  dbCredentials: {
    url: process.env.CORE_DATABASE_URL!,
  },
  casing: 'snake_case',
  migrations: {
    table: '__drizzle_migrations',
    schema: 'core',
  },
})
