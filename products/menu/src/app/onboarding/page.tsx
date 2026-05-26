import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Wordmark } from '@iedora/design-system'
import { getSession } from '@/features/auth'
import { signInUrl } from '@iedora/brand'
import { publicUrl } from '@/shared/url'
import { OnboardingForm } from './onboarding-form'

export default async function OnboardingPage() {
  const session = await getSession()
  if (!session?.user) redirect(signInUrl(publicUrl('/onboarding').toString()))

  // No org-existence gate here: /onboarding doubles as the "add another
  // restaurant" form for existing users. The action (`completeOnboarding`)
  // branches between creating an org + first restaurant vs. adding a
  // restaurant under the existing org (with plan-limit check). The dashboard
  // `+ new restaurant` link points here for that second case.

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)]">
      <div
        className="ds-shell flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-6 font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-55)] sm:pt-9"
        style={{ maxWidth: 1100 }}
      >
        <div className="flex items-center gap-3">
          <span>MMXXVI</span>
          <span aria-hidden="true">·</span>
          <span>Menu · Onboarding</span>
        </div>
        <Link href="/dashboard" className="no-underline">
          Dashboard
        </Link>
      </div>

      <main className="ds-shell flex flex-1 items-center justify-center py-12 sm:py-16">
        <div className="w-full max-w-[560px]">
          <div className="mb-10 flex flex-col items-center gap-2 text-center sm:mb-12">
            <Link
              href="/"
              className="inline-flex items-baseline no-underline"
              aria-label="Menu home"
            >
              <Wordmark
                word="menu"
                variant="display"
                className="ds-wordmark--reveal"
              />
            </Link>
            <span
              className="text-[17px] italic text-[var(--ink-70)]"
              style={{ fontFamily: 'var(--serif)' }}
            >
              name the room
            </span>
          </div>
          <OnboardingForm />
        </div>
      </main>
    </div>
  )
}
