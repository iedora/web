/**
 * @iedora/product-imopush — TBD. Slice tree lands in follow-up commits.
 *
 * Conventions (DIFFERENT from products/menu — observe these from day 0):
 *
 *   - **No `@/` path mapping.** Use RELATIVE imports between slices and
 *     within shared/. This mirrors the convention every other workspace
 *     in the repo uses (packages/core-auth, packages/design-system, …) and
 *     means apps/web's tsconfig never needs a per-product path entry.
 *
 *   - **DB setup via @iedora/db.** `src/shared/db/client.ts` calls
 *     `createDb(env.IMOPUSH_DATABASE_URL, schema, { cacheKey: 'iedora/imopush' })`
 *     — no copy-paste of postgres-js + drizzle wiring.
 *
 *   - **One Postgres database per product.** imopush gets its own DB
 *     (`imopush`), its own DATABASE_URL env (`IMOPUSH_DATABASE_URL`), and
 *     its own drizzle migrations under `./drizzle/`.
 *
 *   - **Public API surface.** Export from this file what apps/web routes
 *     need. Curated, not wildcarded.
 */
export {}
