import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  Wordmark,
  MetaStrip,
  Statement,
  Button,
  Separator,
  VisuallyHidden,
} from '@iedora/design-system'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { env } from '@/shared/env'
import './landing.css'

export const metadata = { title: 'Genkan — the entryway' }

/**
 * Root landing for `genkan.iedora.com`.
 *
 * Signed-in visitors bounce to the configured DEFAULT_RETURN_TO (typically
 * the menu app). Anonymous visitors land here — a small editorial page that
 * names what genkan is, what's inside, and where to go next.
 *
 * Voice + composition mirrors `products/house/src/pages/index.astro` per
 * the "Brand surface" guidance in CLAUDE.md: editorial chrome
 * (Wordmark + MetaStrip + Statement), no marketing flourish, one cinnabar
 * accent (the Sign-in arrow + the wordmark dot).
 */
export default async function GenkanLanding() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect(env.DEFAULT_RETURN_TO)

  return (
    <main className="genkan-landing">
      <VisuallyHidden as="div">Genkan — the entryway to iedora</VisuallyHidden>

      <div className="ds-shell genkan-landing__shell">
        <MetaStrip
          left={
            <>
              <span>MMXXVI</span>
              <span>Identity · Entry</span>
            </>
          }
          right={
            <Link href="/login" className="genkan-landing__nav-cta">
              Sign in
            </Link>
          }
        />

        <header className="genkan-landing__head">
          <h2 className="genkan-landing__mark">
            {/* `--reveal` is applied at render — genkan's brand voice
                is "quieter than menu", so the wordmark appears whole
                rather than staggering letter-by-letter on load. */}
            <Wordmark
              word="genkan"
              variant="display"
              className="ds-wordmark--reveal"
            />
          </h2>
          <Statement>
            The entryway to <em>iedora</em>. Single sign-on, signed sessions,
            audited entries.
          </Statement>

          <div className="genkan-landing__cta">
            <Button as="a" href="/login" variant="solid" arrow>
              Sign in
            </Button>
            <Button as="a" href="/signup" variant="ghost" arrow>
              Create an account
            </Button>
          </div>
        </header>

        <Separator className="genkan-landing__rule" />

        <section className="genkan-landing__inside">
          <p className="genkan-landing__inside-label">What lives inside</p>
          <ul className="genkan-landing__rooms">
            <li>
              <span className="genkan-landing__room-num">/ 01</span>
              <span className="genkan-landing__room-name">Your sessions</span>
              <span className="genkan-landing__room-body">
                Active devices, signed and revocable.
              </span>
            </li>
            <li>
              <span className="genkan-landing__room-num">/ 02</span>
              <span className="genkan-landing__room-name">Your applications</span>
              <span className="genkan-landing__room-body">
                Apps you have authorised to enter your account.
              </span>
            </li>
            <li>
              <span className="genkan-landing__room-num">/ 03</span>
              <span className="genkan-landing__room-name">Your organizations</span>
              <span className="genkan-landing__room-body">
                Teams you belong to, with the works each one keeps.
              </span>
            </li>
            <li>
              <span className="genkan-landing__room-num">/ 04</span>
              <span className="genkan-landing__room-name">Recent entries</span>
              <span className="genkan-landing__room-body">
                A quiet, tamper-evident trail of what passed through.
              </span>
            </li>
          </ul>
        </section>

        <footer className="genkan-landing__foot">
          <span>Built in Iedora<span className="genkan-landing__dot">.</span></span>
          <span>MMXXVI</span>
          <span>genkan.iedora.com</span>
        </footer>
      </div>
    </main>
  )
}
