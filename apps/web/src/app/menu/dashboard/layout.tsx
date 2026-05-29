import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import {
  ActiveSidebarLinks,
  type ActiveSidebarItem,
  Sidebar,
  SidebarBrand,
  SidebarClose,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
  Wordmark,
} from '@iedora/design-system'
import { signInUrl } from '@iedora/product-core/url'
import { publicUrl } from '@iedora/product-menu/shared/url'
import { ONBOARDING_STEPS } from '@iedora/product-menu/features/menu-onboarding'
import {
  getEffectiveOrganizationId,
  getSession,
  IEDORA_ADMIN_ROLE,
} from '@iedora/product-menu/features/auth'
import { detectStaffPreset } from '@iedora/core-auth'
import { listRestaurantsWithCounts } from '@iedora/product-menu/features/dashboard-home'
import { getOrganizationPlan, planHas } from '@iedora/product-menu/features/plans'
import { LogoutButton } from '@iedora/product-menu/features/dashboard-home/ui/logout-button'
import { UserLocaleSwitcher } from '@iedora/product-menu/features/dashboard-home/ui/user-locale-switcher'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Auth gate lives here AND in each page's DAL (`requireActiveOrganization`).
  // Layout-level redirect is OK here because the conditions are uniform
  // across every dashboard descendant: no session → sign-in; session
  // but no active org → onboarding. The per-page DAL guards stay as
  // belt-and-braces (and as the source of truth for testing).
  //
  // Without this gate the dashboard layout would render briefly before
  // the page's `requireActiveOrganization()` redirect fires — flash of
  // empty dashboard chrome on the way to /menu/onboarding. Reported
  // by eduvhc 2026-05-29.
  const session = await getSession()
  if (!session?.user) {
    redirect(signInUrl(publicUrl('/menu/dashboard').toString()))
  }
  const tenantId = await getEffectiveOrganizationId()
  if (!tenantId) {
    redirect(ONBOARDING_STEPS.name.path)
  }
  // Sidebar restaurants section. Lists every restaurant in the active org
  // so the operator can hop between them without going back to /dashboard.
  // Empty when the org has no restaurants yet — the section header is
  // suppressed in that case (see candidates below).
  const [plan, restaurants] = await Promise.all([
    getOrganizationPlan(tenantId),
    listRestaurantsWithCounts(tenantId),
  ])
  const showAnalyticsLink = planHas(plan, 'analytics')
  // QR codes admin is cross-tenant (`requireScope` in
  // `products/menu/src/features/qr-codes/`). Anyone whose user.scopes
  // matches the iedora-admin preset sees it. Sessions / users admin
  // live under the `core` surface — see products/core/src/url.ts.
  const sessionScopes =
    (session?.user as { scopes?: string[] | null } | undefined)?.scopes ?? null
  const isStaffAdmin =
    sessionScopes !== null &&
    detectStaffPreset(sessionScopes as unknown as never[]) === IEDORA_ADMIN_ROLE
  const showAdminLink = isStaffAdmin

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
  //   QR Codes                       (sessions / users live under core)
  //
  // No "Home" entry — the wordmark in the sidebar header already routes
  // to /dashboard and the dashboard's own role is now the org overview,
  // not a sibling of Restaurants. Restaurant links use prefix matching
  // so the current restaurant stays highlighted while the operator is
  // deep in its menus / theme / QR / billing pages.
  const hasAdminGroup = showAdminLink
  const hasRestaurants = restaurants.length > 0
  const candidates: ReadonlyArray<ActiveSidebarItem | false> = [
    hasRestaurants
      ? { kind: 'section', label: nav('restaurants'), testId: 'dashboard-nav-restaurants-section' }
      : { href: '/menu/dashboard', label: nav('restaurants'), testId: 'dashboard-nav-restaurants-empty', matchPrefix: false },
    ...restaurants.map((r) => ({
      href: `/menu/dashboard/r/${r.slug}`,
      label: r.name,
      testId: `dashboard-nav-restaurant-${r.slug}`,
    })),
    showAnalyticsLink && { href: '/menu/dashboard/analytics', label: nav('analytics'), testId: 'dashboard-nav-analytics' },
    { kind: 'section', label: nav('account'), testId: 'dashboard-nav-account-section' },
    { href: '/menu/dashboard/billing', label: nav('billing'), testId: 'dashboard-nav-billing' },
    { href: '/menu/dashboard/misc', label: nav('misc'), testId: 'dashboard-nav-misc' },
    hasAdminGroup && { kind: 'section', label: nav('admin'), testId: 'dashboard-nav-admin-section' },
    showAdminLink && { href: '/menu/dashboard/admin/qr-codes', label: nav('qrCodes'), testId: 'dashboard-nav-admin' },
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
              href="/menu/dashboard"
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
