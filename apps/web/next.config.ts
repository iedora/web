import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const here = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // Standalone output → minimal server.js bundle for Docker.
  output: 'standalone',
  // Bun workspaces monorepo: trace files up to the workspace root (two
  // levels above this file). Without this Next emits a warning and
  // traces only inside apps/web/, missing the per-product packages.
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
    // Two schemas ship with the image:
    //   - menu's own `drizzle/` + `scripts/migrate.mjs` (DATABASE_URL)
    //   - @iedora/auth's `drizzle/` + `scripts/migrate.mjs` (CORE_DATABASE_URL)
    '/*': [
      './node_modules/drizzle-orm/**/*',
      './node_modules/postgres/**/*',
      '../../products/menu/drizzle/**/*',
      '../../products/menu/scripts/migrate.mjs',
      '../../packages/auth/drizzle/**/*',
      '../../packages/auth/scripts/migrate.mjs',
    ],
  },
  allowedDevOrigins: ['menu.733113.xyz'],
}

// next-intl's request config lives with the messages catalogues in
// @iedora/product-menu. apps/web wires it via the relative path.
const withNextIntl = createNextIntlPlugin(
  '../../products/menu/src/i18n/request.ts',
)
export default withNextIntl(nextConfig)
