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
    '@iedora/product-menu',
  ],
  // Version skew protection — forces hard navigation when the client
  // holds assets from a previous deployment. Passed as
  // DEPLOYMENT_VERSION build-arg from CI (typically commit SHA).
  deploymentId: process.env.DEPLOYMENT_VERSION,
  allowedDevOrigins: ['menu.733113.xyz'],
  // The public-menu view beacon. The page renders <img src="/track/:slug">;
  // the Go menu service answers with a 1×1 gif and counts the view.
  async rewrites() {
    return [
      {
        source: '/track/:slug',
        destination: `${process.env.MENU_URL ?? 'http://localhost:8084'}/public/track/:slug`,
      },
    ]
  },
}

// next-intl's request config lives with the messages catalogues in
// @iedora/product-menu. apps/web wires it via the relative path.
const withNextIntl = createNextIntlPlugin(
  '../../products/menu/src/i18n/request.ts',
)
export default withNextIntl(nextConfig)
