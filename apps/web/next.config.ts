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
    '@iedora/product-menu',
  ],
  // Força drizzle-orm + postgres-js a ficarem em node_modules do
  // standalone bundle (em vez de inlined nos webpack chunks). É
  // necessário para os `<workspace>/migrate.mjs` (pre-deploy hook)
  // os conseguirem resolver via Node's resolution standard.
  serverExternalPackages: ['drizzle-orm', 'postgres'],
  // serverExternalPackages só controla bundler. Para garantir que
  // os pacotes são copiados para .next/standalone/node_modules
  // (nft trace pode falhar com conditional/dynamic exports do drizzle),
  // forçamos inclusão explícita aqui. Substitui o hack anterior de
  // `npm install` no Dockerfile runtime stage.
  outputFileTracingIncludes: {
    '/*': [
      '../../node_modules/drizzle-orm/**/*',
      '../../node_modules/postgres/**/*',
    ],
  },
  // No `outputFileTracingIncludes` for migrate scripts — they're
  // bundled in apps/web/Dockerfile's `migrate-bundler` stage (single
  // ESM file each, all deps inlined). The Next standalone output is
  // for the request-serving path only.
  // Version skew protection — forces hard navigation when the client
  // holds assets from a previous deployment. Passed as
  // DEPLOYMENT_VERSION build-arg from CI (typically commit SHA).
  deploymentId: process.env.DEPLOYMENT_VERSION,
  allowedDevOrigins: ['menu.733113.xyz'],
}

// next-intl's request config lives with the messages catalogues in
// @iedora/product-menu. apps/web wires it via the relative path.
const withNextIntl = createNextIntlPlugin(
  '../../products/menu/src/i18n/request.ts',
)
export default withNextIntl(nextConfig)
