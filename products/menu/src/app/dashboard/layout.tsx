import Link from 'next/link'
import { Wordmark } from '@iedora/design-system'
import {
  getEffectiveOrganizationId,
  getSession,
  SCOPES,
} from '@/features/auth'
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
  const session = await getSession()
  const organizationId = session?.user
    ? await getEffectiveOrganizationId(session.user.id)
    : null
  const plan = organizationId
    ? await getOrganizationPlan(organizationId)
    : null
  const showAnalyticsLink = plan ? planHas(plan, 'analytics') : false
  // Chrome decision mirrors the page-level gate (`requireScope(QR_CODES_READ)`)
  // so anyone with read permission — bundle holder or atomic grant — sees
  // the link, and only those.
  const showAdminLink =
    session?.user.permissions.includes(SCOPES.QR_CODES_READ) ?? false

  const navLinkClass =
    "font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-55)] no-underline transition-colors hover:text-[var(--ink)] py-1.5"

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)]">
      {/* Top meta strip */}
      <div className="border-b border-[var(--ink-14)]">
        <div className="ds-shell flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 text-[10.5px] uppercase tracking-[0.18em] font-[family-name:var(--mono)] text-[var(--ink-55)]">
          <div className="flex items-center gap-3">
            <span>MMXXVI</span>
            <span aria-hidden="true">·</span>
            <span>iedora · menu</span>
          </div>
          <UserLocaleSwitcher />
        </div>
      </div>

      {/* Wordmark + nav — mobile-first column, row at sm: */}
      <header className="border-b border-[var(--ink-14)]">
        <div className="ds-shell flex flex-col gap-3 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6 sm:py-6">
          <Link
            href="/dashboard"
            className="inline-flex shrink-0 items-baseline no-underline"
            aria-label="Menu home"
          >
            <Wordmark
              word="menu"
              variant="inline"
              className="ds-wordmark--reveal"
            />
          </Link>
          <nav className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-2">
            {showAnalyticsLink && (
              <Link
                href="/dashboard/analytics"
                data-testid="nav-analytics"
                className={navLinkClass}
              >
                Analytics
              </Link>
            )}
            <Link href="/dashboard/billing" className={navLinkClass}>
              Billing
            </Link>
            {showAdminLink && (
              <Link
                href="/dashboard/admin/qr-codes"
                data-testid="nav-admin"
                className={navLinkClass}
              >
                Admin
              </Link>
            )}
            {session?.user && (
              <span
                className="hidden min-w-0 truncate font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)] md:inline"
                title={session.user.email}
              >
                {session.user.email}
              </span>
            )}
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="ds-shell flex-1 py-8 sm:py-12">{children}</main>
    </div>
  )
}
