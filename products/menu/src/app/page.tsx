import { redirect } from 'next/navigation'
import { getEffectiveOrganizationId, getSession } from '@/features/auth'
import LandingPage from './_components/landing/landing-page'

export default async function Home() {
  const session = await getSession()
  if (session) {
    const organizationId = await getEffectiveOrganizationId(session.user.id)
    if (!organizationId) redirect('/onboarding')
    redirect('/dashboard')
  }
  return <LandingPage />
}
