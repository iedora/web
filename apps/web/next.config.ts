import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

// __dirname equivalent in ESM — products/menu/.
const here = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // Standalone output gera um bundle minimal com server.js — ideal para Docker
  output: 'standalone',
  // Bun workspaces monorepo: tell Next to trace files up to the workspace
  // root (two levels above this file) so the standalone build includes the
  // linked @iedora/design-system package + its CSS / fonts. Without this
  // Next emits a warning and traces only inside products/menu/.
  outputFileTracingRoot: path.join(here, '..', '..'),
  transpilePackages: [
    '@iedora/design-system',
    '@iedora/observability',
    '@iedora/product-core',
    '@iedora/product-house',
    '@iedora/product-menu',
  ],
  outputFileTracingIncludes: {
    // Force-include files the migrate scripts need at runtime —
    // Turbopack's standalone trace misses them otherwise (vercel/next.js#88844).
    // Two schemas ship with the menu image:
    //   - menu's own `./drizzle/` + `./scripts/migrate.mjs` (applied
    //     against DATABASE_URL),
    //   - `@iedora/auth`'s `drizzle/` + `scripts/migrate.mjs` (applied
    //     against CORE_DATABASE_URL — the core product's schema, run
    //     as a separate Stage 3 configurator).
    '/*': [
      './node_modules/drizzle-orm/**/*',
      './node_modules/postgres/**/*',
      './drizzle/**/*',
      './scripts/migrate.mjs',
      '../../packages/auth/drizzle/**/*',
      '../../packages/auth/scripts/migrate.mjs',
    ],
  },
  allowedDevOrigins: [
    'menu.733113.xyz'
  ],
  // `next build` typechecks everything reachable from tsconfig include.
  // Tests import @iedora/auth-testkit which re-exports genkan's schema
  // via a workspace-relative path that doesn't exist in menu's Docker
  // build context (only menu + packages/* are copied). Point the build
  // at a tsconfig that excludes tests; `bun run typecheck` still uses
  // the unrestricted tsconfig.json so dev + CI catch test typos.
  typescript: {
    tsconfigPath: './tsconfig.build.json',
  },
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
export default withNextIntl(nextConfig)
