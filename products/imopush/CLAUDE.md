# imopush — `products/imopush/`

Scaffold only — slices land in follow-up commits. This package exists
to demonstrate the **post-Opt-B conventions for new products** and to
serve as a copy-target when the next product is created.

Repo-level conventions: [`../../AGENTS.md`](../../AGENTS.md).

## Hard rules

1. **No `@/` path mapping.** Slices import each other via RELATIVE
   paths (`../<slice>/<file>`) — same convention as `packages/core-auth`,
   `packages/design-system`, every other workspace package. This is
   what lets `apps/web/tsconfig.json` stay clean of per-product path
   entries as the repo grows.

   The legacy `@/` mapping in `products/menu/` is a hangover from
   menu's pre-Opt-B life as a Next app. New products do not inherit
   that smell.

2. **One Postgres database per product.** imopush gets:
   - DB name: `imopush`
   - URL env: `IMOPUSH_DATABASE_URL`
   - pg-schema: `imopush.*`
   - migrations: `./drizzle/`, tracked in `imopush.__drizzle_migrations`

3. **DB setup via `@iedora/db`.** `src/shared/db/client.ts` calls
   `createDb(...)` — never duplicate the postgres-js + drizzle wiring.

4. **Public API is curated.** Add explicit exports to
   `src/index.ts` for what apps/web routes need. No wildcards.

## File layout (expected)

```
products/imopush/
  src/
    index.ts             package barrel — curated exports for apps/web
    shared/
      db/
        client.ts        createDb(env.IMOPUSH_DATABASE_URL, schema)
        schema.ts        imopush.<table> drizzle definitions
      env.ts             Zod-validated env shape
    features/            slices land here (one folder per capability)
  drizzle/               generated SQL migrations (drizzle-kit)
  drizzle.config.ts
  package.json
  tsconfig.json
  eslint.config.mjs
  vitest.config.ts
  CLAUDE.md (this file)
```

## Commands

- `bun run typecheck`
- `bun run lint`
- `bun run test` — vitest, `--passWithNoTests` until slices land.
- `bun run db:generate` — generate a drizzle migration from schema.ts diff.
- `bun run db:migrate` — apply pending migrations.

## Mounting in apps/web (when ready)

When imopush surfaces are ready to render:

1. Add `imopush` host pattern to `apps/web/src/proxy.ts`.
2. Add `apps/web/src/app/imopush/` with `page.tsx` etc. that import
   from `@iedora/product-imopush`.
3. Add `@iedora/product-imopush` to `apps/web/package.json` deps +
   `next.config.ts::transpilePackages`.

No `apps/web/tsconfig.json` edits required (relative-imports-only
convention).

## CI

`.gitea/workflows/ci.yml` — single job: typecheck + lint + test for all
workspaces (imopush included).
