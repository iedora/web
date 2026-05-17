import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const here = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  output: 'standalone',
  // Bun workspaces monorepo — trace files up to the workspace root so the
  // standalone build includes the linked @iedora/design-system.
  outputFileTracingRoot: path.join(here, '..', '..'),
  transpilePackages: ['@iedora/design-system', '@iedora/identity'],
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/drizzle-orm/**/*',
      './node_modules/postgres/**/*',
      './drizzle/**/*',
      // Migration runner — Kamal invokes this on every container start
      // via `servers.<role>.cmd`.
      './scripts/migrate.mjs',
    ],
  },
}

export default nextConfig
