import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

// Installable PWA scope = /menu/dashboard. Manifest lives in /public so
// it ships as a static asset; icons under /public/icons are shared by
// the manifest entries and the iOS apple-touch link.
export const metadata: Metadata = {
  manifest: '/menu/dashboard/manifest.webmanifest',
  applicationName: 'Iedora Menu',
  appleWebApp: {
    capable: true,
    title: 'Iedora',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#EFE7D7',
}
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
import { signInUrl } from '@iedora/product-menu/shared/auth-urls'
import { publicUrl } from '@iedora/product-menu/shared/url'
import { ONBOARDING_STEPS } from '@iedora/product-menu/features/menu-onboarding'
import { getSession, isStaff } from '@iedora/product-menu/features/auth'
import { listRestaurantsWithCounts } from '@iedora/product-menu/features/dashboard-home'
import { DEFAULT_PLAN, getOrganizationPlan, planHas } from '@iedora/product-menu/features/plans'
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
  // Translations + session run concurrently — neither depends on the
  // other. The session read dedupes via React.cache, so the pages'
  // own guards share the same cookie parse.
  const tPromise = getTranslations('AppHeader')
  const navPromise = getTranslations('DashboardNav')
  const session = await getSession()

  if (!session) {
    redirect(signInUrl(publicUrl('/menu/dashboard').toString()))
  }
  // Staff (iedora-admin / iedora-support) are cross-tenant operators;
  // they don't need to belong to a tenant to land on the dashboard.
  const tenantId = session.tenantId
  const isStaffAdmin = isStaff(session)
  const showAdminLink = isStaffAdmin

  if (!tenantId && !isStaffAdmin) {
    redirect(ONBOARDING_STEPS.name.path)
  }
  // Sidebar restaurants section. Lists every restaurant in the active org
  // so the operator can hop between them without going back to /dashboard.
  // Empty when the org has no restaurants yet — the section header is
  // suppressed in that case (see candidates below). Staff without a
  // tenant get empty restaurants + the default plan.
  const [t, nav, plan, restaurants] = await Promise.all([
    tPromise,
    navPromise,
    tenantId ? getOrganizationPlan() : Promise.resolve(DEFAULT_PLAN),
    tenantId
      ? listRestaurantsWithCounts()
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof listRestaurantsWithCounts>>,
        ),
  ])
  const showAnalyticsLink = planHas(plan, 'analytics')

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
  //   QR Codes                       (sessions / users live in the Go admin BFF)
  //
  // No "Home" entry — the wordmark in the sidebar header already routes
  // to /dashboard and the dashboard's own role is now the org overview,
  // not a sibling of Restaurants. Restaurant links use prefix matching
  // so the current restaurant stays highlighted while the operator is
  // deep in its menus / theme / QR / billing pages.
  const hasAdminGroup = showAdminLink
  const hasRestaurants = restaurants.length > 0
  // Staff manage every restaurant through Admin → Restaurantes, so we
  // hide the tenant-level Restaurants section + per-restaurant links
  // for them — keeps the sidebar focused on the admin surfaces.
  const showRestaurantsGroup = !isStaffAdmin
  const candidates: ReadonlyArray<ActiveSidebarItem | false> = [
    showRestaurantsGroup &&
      (hasRestaurants
        ? { kind: 'section', label: nav('restaurants'), testId: 'dashboard-nav-restaurants-section' }
        : { href: '/menu/dashboard', label: nav('restaurants'), testId: 'dashboard-nav-restaurants-empty', matchPrefix: false }),
    ...(showRestaurantsGroup
      ? restaurants.map((r) => ({
          href: `/menu/dashboard/r/${r.slug}`,
          label: r.name,
          testId: `dashboard-nav-restaurant-${r.slug}`,
        }))
      : []),
    showAnalyticsLink && { href: '/menu/dashboard/analytics', label: nav('analytics'), testId: 'dashboard-nav-analytics' },
    // Account section (billing + misc) is per-tenant — hide for staff
    // without a tenant pinned, otherwise the link redirects back to
    // /menu/dashboard (the staff branch of requireActiveOrganization).
    Boolean(tenantId) && { kind: 'section', label: nav('account'), testId: 'dashboard-nav-account-section' },
    Boolean(tenantId) && { href: '/menu/dashboard/billing', label: nav('billing'), testId: 'dashboard-nav-billing' },
    Boolean(tenantId) && { href: '/menu/dashboard/misc', label: nav('misc'), testId: 'dashboard-nav-misc' },
    hasAdminGroup && { kind: 'section', label: nav('admin'), testId: 'dashboard-nav-admin-section' },
    showAdminLink && { href: '/menu/dashboard/admin/restaurants', label: nav('restaurants'), testId: 'dashboard-nav-admin-restaurants' },
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
            <span
              className="min-w-0 truncate font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)]"
              title={session.email ?? undefined}
              data-test-id="dashboard-user-email"
            >
              {session.email}
            </span>
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
