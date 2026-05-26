import type { Metadata } from 'next'
import { Wordmark } from '@iedora/design-system'

/**
 * iedora.com — the brand landing page. Lives in `@iedora/product-house`
 * and is mounted by `apps/web` at `/house/*` via a thin re-export in
 * `apps/web/src/app/house/page.tsx`. `proxy.ts` rewrites the apex
 * host (`iedora.com`) into `/house/*` so the user-visible URL stays
 * clean.
 *
 * Deliberately minimal — a single statement + two CTAs. The richer
 * marketing copy can grow back here once the second product ships and
 * there's a reason to.
 */

export const metadata: Metadata = {
  title: 'Iedora. House of Software.',
  description: 'We do software with quality.',
}

const contactEmail = 'hi@iedora.com'
const menuUrl = 'https://menu.iedora.com'

export default function HouseLanding() {
  return (
    <main className="ds-shell" id="top">
      <header className="ds-hero" data-test-id="house-hero">
        <span className="ds-eyebrow">
          <span className="ds-eyebrow__idx">/ 00</span>
          <span>
            <Wordmark variant="inline" />
          </span>
        </span>
        <h1 className="ds-hero__h ds-hero__h--dot">
          We do software <em>with quality</em>.
        </h1>
        <p className="ds-hero__tagline">
          A small house in Oporto and Lisboa. Patient work, quiet interfaces.
        </p>
        <div className="ds-hero__ctas">
          <a
            className="ds-btn ds-btn--primary"
            href={menuUrl}
            rel="noopener"
            data-test-id="house-cta-menu"
          >
            <span>See our first product — menu</span>
            <span className="ds-btn__arrow" aria-hidden="true">
              →
            </span>
          </a>
          <a
            className="ds-btn"
            href={`mailto:${contactEmail}`}
            data-test-id="house-cta-contact"
          >
            <span>Write to {contactEmail}</span>
          </a>
        </div>
      </header>
    </main>
  )
}
