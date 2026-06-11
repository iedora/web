import Link from 'next/link'
import { Masthead, Stage } from '@iedora/design-system'
import { brandUrl } from '@iedora/brand'

/**
 * Centered chrome for the auth flow (sign-in / sign-up / sign-out).
 * Same paper-card vocabulary the onboarding wizard uses — Stage owns
 * the paper grain + vignette, Masthead provides the `iedora•` wordmark
 * + course italic, and the inner Card from each page renders as the
 * focused form surface.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Stage>
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        <Link
          href={brandUrl()}
          aria-label="iedora"
          className="inline-flex items-baseline justify-center self-center no-underline w-full"
        >
          <Masthead word="iedora" />
        </Link>
        {children}
      </div>
    </Stage>
  )
}
