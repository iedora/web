/**
 * @iedora/db — shared drizzle-orm + postgres-js setup. Consumers
 * (every product workspace with a Postgres database) call `createDb`
 * with their URL + schema and get back a typed drizzle client plus
 * ping/close helpers with consistent semantics across products.
 *
 * Why this exists: every product (menu, …) needs the same
 * wiring — postgres-js pool with HMR-safe globalThis caching,
 * drizzle wrapper with `casing: 'snake_case'`, ping for health
 * routes, graceful drain on SIGTERM. Copy-paste between products was
 * the original sin we're removing here.
 *
 * What lives here vs in the product:
 *   - here       generic factory + connection pool + lifecycle helpers
 *   - product    its own schema (drizzle table definitions), its own
 *                env binding, its own migrations folder
 *
 * Test fixture in `./testing` (subpath import). PGLite-based; same
 * generic shape — the consumer brings its schema + migrations path.
 */
export { createDb, type CreateDbOptions } from './client'
