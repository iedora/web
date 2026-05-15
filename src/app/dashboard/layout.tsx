import Link from 'next/link'
import { headers } from 'next/headers'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { getEffectiveOrganizationId } from '@/features/auth'
import { getOrganizationPlan, planHas } from '@/features/plans'
import { LogoutButton } from '@/features/dashboard-home/ui/logout-button'
import { UserLocaleSwitcher } from '@/features/dashboard-home/ui/user-locale-switcher'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Soft fetches only — layouts don't re-render on navigation in Next 16, so
  // a stale `redirect()` here would leak across pages. Real gating lives in
  // the per-page DAL guards (`verifySession`, `requireActiveOrganization`).
  // The layout only needs whatever data the chrome renders; missing values
  // collapse the relevant slots instead of throwing.
  const session = await auth.api.getSession({ headers: await headers() })
  const organizationId = session?.user
    ? await getEffectiveOrganizationId(
        session.user.id,
        session.session.activeOrganizationId,
      )
    : null
  const plan = organizationId
    ? await getOrganizationPlan(organizationId)
    : null
  const showAnalyticsLink = plan ? planHas(plan, 'analytics') : false

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/dashboard"
            className="inline-flex shrink-0 items-baseline gap-2 text-foreground no-underline"
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
          <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-4">
            <UserLocaleSwitcher />
            {showAnalyticsLink && (
              <Link
                href="/dashboard/analytics"
                data-testid="nav-analytics"
                className="text-muted-foreground hover:underline"
              >
                Analytics
              </Link>
            )}
            <Link
              href="/dashboard/billing"
              className="text-muted-foreground hover:underline"
            >
              Billing
            </Link>
            {session?.user && (
              <span className="hidden truncate text-muted-foreground sm:inline">
                {session.user.email}
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
