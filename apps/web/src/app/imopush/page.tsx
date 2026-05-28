import type { Metadata } from 'next'
import LandingPage from './_components/landing/landing-page'

/**
 * imopush.iedora.com — the imopush product surface. `proxy.ts` rewrites
 * the `imopush.iedora.com` host into `/imopush/*` so the user-visible
 * URL stays clean. Today the surface is the coming-soon landing; the
 * first feature slice will land at a sub-route.
 */

export const metadata: Metadata = {
  title: 'imopush — one listing, every portal',
  description:
    'Publish your property once on imopush and it lands on Idealista, Custojusto, OLX and Imovirtual automatically.',
}

export default function ImopushSurface() {
  return <LandingPage />
}
