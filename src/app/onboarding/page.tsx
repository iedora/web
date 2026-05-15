import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { OnboardingForm } from './onboarding-form'

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/login')

  // No org-existence gate here: /onboarding doubles as the "add another
  // restaurant" form for existing users. The action (`completeOnboarding`)
  // branches between creating an org + first restaurant vs. adding a
  // restaurant under the existing org (with plan-limit check). The dashboard
  // `+ new restaurant` link points here for that second case.

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Link
        href="/"
        className="mb-6 inline-flex items-baseline gap-2 text-foreground no-underline"
        aria-label="Meta Menu home"
      >
        <span
          aria-hidden="true"
          className="translate-y-[2px] font-serif text-[22px] italic leading-none text-brand"
        >
          ⁋
        </span>
        <span className="text-[15px] font-semibold tracking-tight">
          Meta <em className="font-serif italic font-medium">Menu</em>
        </span>
      </Link>
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </div>
  )
}
