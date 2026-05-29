import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BRAND_URL } from '@iedora/brand'
import {
  Badge,
  Sidebar,
  SidebarBrand,
  SidebarClose,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
  Wordmark,
} from '@iedora/design-system'
import { SCOPES, type Scope } from '@iedora/core-auth/scopes'
import { ActiveSidebarLinks, type ActiveSidebarItem } from '@iedora/design-system'

/**
 * Cross-tenant admin chrome. Two-column on lg+, drawer on mobile.
 * No restaurant context — the sidebar is a fixed taxonomy of admin
 * surfaces (overview / users / access / orgs / sessions). Keep the
 * taxonomy short — if it grows past six, add a second section group.
 *
 * `userRole` powers the footer chip ("iedora-admin" / "iedora-support")
 * so the active grouper is always visible — reinforces the "role is a
 * grouper, scopes are the real currency" model.
 */
export async function AdminShell({
  children,
  userEmail,
  userScopes,
  staffRoleLabel,
}: {
  children: React.ReactNode
  userEmail: string
  /** Cross-tenant scope set (from `user.scopes`). Null for tenant-only users. */
  userScopes: readonly Scope[] | null
  /** UI label for the chip — e.g. `'iedora-admin'`. Detected by `detectStaffPreset`. */
  staffRoleLabel: string | null
}) {
  const t = await getTranslations('Core.admin.nav')

  // Scope-aware nav: omits links the caller can't reach. Reads scopes
  // directly from the array (no AC binding indirection).
  const canSeeAudit = userScopes?.includes(SCOPES.core.staff.audit.read) ?? false

  const items: ReadonlyArray<ActiveSidebarItem> = [
    {
      kind: 'section',
      label: t('sectionAdmin'),
      testId: 'admin-nav-section-admin',
    },
    {
      href: '/core/admin',
      label: t('overview'),
      matchPrefix: false,
      testId: 'admin-nav-overview',
    },
    {
      href: '/core/admin/users',
      label: t('users'),
      testId: 'admin-nav-users',
    },
    {
      href: '/core/admin/access',
      label: t('access'),
      testId: 'admin-nav-access',
    },
    {
      href: '/core/admin/tenants',
      label: t('tenants'),
      testId: 'admin-nav-tenants',
    },
    {
      href: '/core/admin/sessions',
      label: t('sessions'),
      testId: 'admin-nav-sessions',
    },
    ...(canSeeAudit
      ? ([
          {
            href: '/core/admin/audit',
            label: t('audit'),
            testId: 'admin-nav-audit',
          },
        ] as const)
      : []),
    { kind: 'section', label: t('sectionExit'), testId: 'admin-nav-section-exit' },
    { href: '/sign-out', label: t('signOut'), testId: 'admin-nav-sign-out' },
  ]

  return (
    <SidebarProvider>
      <div className="flex min-h-screen flex-col bg-[var(--paper)] lg:flex-row">
        <SidebarTrigger
          aria-label={t('openNavigation')}
          data-test-id="admin-sidebar-trigger"
        />

        <Sidebar aria-label={t('ariaLabel')} data-test-id="admin-chrome">
          <SidebarClose
            aria-label={t('closeNavigation')}
            data-test-id="admin-sidebar-close"
          />
          <SidebarBrand>
            <Link
              href={BRAND_URL}
              className="brand"
              aria-label={t('brandHome')}
              data-test-id="admin-home-link"
            >
              <Wordmark word="admin" variant="inline" className="ds-wordmark--reveal" />
            </Link>
          </SidebarBrand>

          <ActiveSidebarLinks ariaLabel={t('ariaLabel')} items={items} />

          <SidebarFooter>
            <div className="min-w-0 space-y-1.5">
              <span
                className="block min-w-0 truncate font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)]"
                title={userEmail}
                data-test-id="admin-user-email"
              >
                {userEmail}
              </span>
              {staffRoleLabel ? (
                <Badge
                  variant={staffRoleLabel === 'iedora-admin' ? 'accent' : 'ink'}
                  data-test-id="admin-user-role"
                >
                  {staffRoleLabel}
                </Badge>
              ) : null}
            </div>
          </SidebarFooter>
        </Sidebar>

        <main className="ds-shell flex-1 pt-5 pb-10 sm:pt-7 sm:pb-14 lg:pt-8 lg:pb-16 px-4 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}
