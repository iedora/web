import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getEffectiveOrganizationId } from '@/lib/dal'
import { OnboardingForm } from './onboarding-form'

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/login')

  const organizationId = await getEffectiveOrganizationId(
    session.user.id,
    session.session.activeOrganizationId,
  )
  if (organizationId) redirect('/dashboard')

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </div>
  )
}
