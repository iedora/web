import { redirect } from 'next/navigation'
import { getSession, isStaff } from '@iedora/product-menu/features/auth'
import { ONBOARDING_STEPS } from '@iedora/product-menu/features/menu-onboarding'
import LandingPage from './_components/landing/landing-page'

export default async function Home() {
  const session = await getSession()
  if (session) {
    // Staff (iedora-admin / iedora-support) are cross-tenant operators
    // and don't need to belong to a tenant to use the dashboard —
    // skip the onboarding redirect for them.
    if (!session.tenantId && !isStaff(session)) {
      redirect(ONBOARDING_STEPS.name.path)
    }
    redirect('/menu/dashboard')
  }
  return <LandingPage />
}
