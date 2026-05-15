import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { getEffectiveOrganizationId } from '@/features/auth'
import LandingPage from './_components/landing/landing-page'

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) {
    const organizationId = await getEffectiveOrganizationId(
      session.user.id,
      session.session.activeOrganizationId,
    )
    if (!organizationId) redirect('/onboarding')
    redirect('/dashboard')
  }
  return <LandingPage />
}
