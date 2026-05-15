import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const nextConfig: NextConfig = {
  // Standalone output gera um bundle minimal com server.js — ideal para Docker
  output: 'standalone',
  outputFileTracingIncludes: {
    // Workaround: Turbopack standalone não rastreia drizzle-orm/postgres
    // automaticamente porque a app importa-os mas o `scripts/migrate.mjs`
    // (executado via `kamal app exec`) também precisa deles em disco.
    // Ref: vercel/next.js#88844
    '/*': [
      './node_modules/drizzle-orm/**/*',
      './node_modules/postgres/**/*',
      './drizzle/**/*',
      './scripts/migrate.mjs',
    ],
  },
  allowedDevOrigins: [
    'metamenu.733113.xyz'
  ]
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
export default withNextIntl(nextConfig)
