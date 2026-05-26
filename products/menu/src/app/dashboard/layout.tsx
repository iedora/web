import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  Sidebar,
  SidebarBrand,
  SidebarClose,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
  Wordmark,
} from '@iedora/design-system'
import {
  getEffectiveOrganizationId,
  getSession,
  IEDORA_ADMIN_ROLE,
  SCOPES,
} from '@/features/auth'
import { listRestaurantsWithCounts } from '@/features/dashboard-home'
import { getOrganizationPlan, planHas } from '@/features/plans'
import { LogoutButton } from '@/features/dashboard-home/ui/logout-button'
import { UserLocaleSwitcher } from '@/features/dashboard-home/ui/user-locale-switcher'
import {
  ActiveSidebarLinks,
  type ActiveSidebarItem,
} from '@/shared/ui/active-sidebar-links'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Soft fetches only — layouts don't re-render on navigation in Next 16, so
  // a stale `redirect()` here would leak across pages. Real gating lives in
  // the per-page DAL guards (`verifySession`, `requireActiveOrganization`).
  const session = await getSession()
  const organizationId = session?.user
    ? await getEffectiveOrganizationId(session.user.id)
    : null
  const plan = organizationId
    ? await getOrganizationPlan(organizationId)
    : null
  // Sidebar restaurants section. Lists every restaurant in the active org
  // so the operator can hop between them without going back to /dashboard.
  // Empty when the user is logged out or has no restaurants yet — the
  // section header is suppressed in that case (see candidates below).
  const restaurants = organizationId
    ? await listRestaurantsWithCounts(organizationId)
    : []
  const showAnalyticsLink = plan ? planHas(plan, 'analytics') : false
  const showAdminLink =
    session?.user.permissions.includes(SCOPES.QR_CODES_READ) ?? false
  const showSessionsLink =
    session?.user.roles.includes(IEDORA_ADMIN_ROLE) ?? false

  const t = await getTranslations('AppHeader')
  const nav = await getTranslations('DashboardNav')

  // Primary nav layout:
  //   ── Restaurants ──            ← anchor of the sidebar. Listed by name
  //   <restaurant 1>                so the operator can hop between them
  //   <restaurant 2> …              from any nested page. Falls back to a
  //                                 single "Restaurants" link to /dashboard
  //                                 when the org has none yet — that page
  //                                 is where the empty-state + onboarding
  //                                 CTA live.
  //   Analytics
  //   ── Account ──                ← billing + AI usage live under here
  //   Billing / Misc
  //   ── Admin ──                  ← only for cross-tenant tools
  //   QR Codes / Sessions
  //
  // No "Home" entry — the wordmark in the sidebar header already routes
  // to /dashboard and the dashboard's own role is now the org overview,
  // not a sibling of Restaurants. Restaurant links use prefix matching
  // so the current restaurant stays highlighted while the operator is
  // deep in its menus / theme / QR / billing pages.
  const hasAdminGroup = showAdminLink || showSessionsLink
  const hasRestaurants = restaurants.length > 0
  const candidates: ReadonlyArray<ActiveSidebarItem | false> = [
    hasRestaurants
      ? { kind: 'section', label: nav('restaurants'), testId: 'dashboard-nav-restaurants-section' }
      : { href: '/dashboard', label: nav('restaurants'), testId: 'dashboard-nav-restaurants-empty', matchPrefix: false },
    ...restaurants.map((r) => ({
      href: `/dashboard/r/${r.slug}`,
      label: r.name,
      testId: `dashboard-nav-restaurant-${r.slug}`,
    })),
    showAnalyticsLink && { href: '/dashboard/analytics', label: nav('analytics'), testId: 'dashboard-nav-analytics' },
    { kind: 'section', label: nav('account'), testId: 'dashboard-nav-account-section' },
    { href: '/dashboard/billing', label: nav('billing'), testId: 'dashboard-nav-billing' },
    { href: '/dashboard/misc', label: nav('misc'), testId: 'dashboard-nav-misc' },
    hasAdminGroup && { kind: 'section', label: nav('admin'), testId: 'dashboard-nav-admin-section' },
    showAdminLink && { href: '/dashboard/admin/qr-codes', label: nav('qrCodes'), testId: 'dashboard-nav-admin' },
    showSessionsLink && { href: '/dashboard/admin/sessions', label: nav('sessions'), testId: 'dashboard-nav-sessions' },
  ]
  const navItems = candidates.filter((x): x is ActiveSidebarItem => Boolean(x))

  return (
    <SidebarProvider>
      <div className="flex min-h-screen flex-col bg-[var(--paper)] lg:flex-row">
        {/* Hamburger floats top-left below `lg`, hidden at desktop. No
            dedicated mobile bar — the page content claims the full
            viewport and the button overlays it. */}
        <SidebarTrigger
          aria-label={t('openNavigation')}
          data-test-id="dashboard-sidebar-trigger"
        />

        <Sidebar aria-label={nav('ariaLabel')} data-test-id="dashboard-chrome">
          <SidebarClose
            aria-label={t('closeNavigation')}
            data-test-id="dashboard-sidebar-close"
          />
          <SidebarBrand>
            <Link
              href="/dashboard"
              className="brand"
              aria-label={t('brandHome')}
              data-test-id="dashboard-home-link"
            >
              <Wordmark word="menu" variant="inline" className="ds-wordmark--reveal" />
            </Link>
          </SidebarBrand>

          {/* `ActiveSidebarLinks` is a tiny client island over
              `<SidebarLinks>` — reads `usePathname()` once and maps
              to `<SidebarLink asChild active=…><Link/></SidebarLink>`
              so client-side routing + prefetch stay intact AND the
              cinnabar rail lights the right item. */}
          <ActiveSidebarLinks ariaLabel={nav('ariaLabel')} items={navItems} />

          <SidebarFooter>
            <UserLocaleSwitcher />
            {session?.user && (
              <span
                className="min-w-0 truncate font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)]"
                title={session.user.email}
                data-test-id="dashboard-user-email"
              >
                {session.user.email}
              </span>
            )}
            <LogoutButton />
          </SidebarFooter>
        </Sidebar>

        <main className="ds-shell flex-1 pt-5 pb-10 sm:pt-7 sm:pb-14 lg:pt-8 lg:pb-16">
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}
