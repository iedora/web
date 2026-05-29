import { getTranslations } from 'next-intl/server'
import {
  Card,
  CardTitle,
  CardDesc,
  CardFoot,
  Button,
  Badge,
} from '@iedora/design-system'
import { requireScope } from '@iedora/product-core'
import { SCOPES } from '@iedora/auth/scopes'
import { detectStaffPreset } from '@iedora/auth'
import type { Scope } from '@iedora/auth/scopes'
import { listUsers } from '@iedora/auth/server'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'

/**
 * Admin overview — landing for /core/admin. Two stacked layers:
 *
 *   1. "Signed in as" identity card — the smoking-gun proof that
 *      whoever's looking carries `iedora-admin`. Doubles as the hook
 *      validator: after the bootstrap signup, the badge here is
 *      the immediate yes/no answer.
 *   2. Three jump-off cards (users / orgs / sessions) carrying real
 *      aggregate counts for users + orgs. Sessions stays
 *      qualitative — `listAllSessions` has no cheap total and the
 *      number churns by the minute.
 *
 * Mobile-first: identity card is full-width and stacks vertically
 * under sm; stat cards go 1→2→3 cols across breakpoints.
 */
export default async function CoreAdminOverview() {
  const session = await requireScope(SCOPES.core.staff.admin.read)
  const t = await getTranslations('Core.admin.overview')

  // Cheap aggregate — listUsers paginates by default; we just want a
  // count probe. (When @iedora/auth.listUsers grows a `total` we can
  // skip the row fetch entirely.)
  const usersPage = await listUsers({ limit: 1 })
  const totalUsers = usersPage.users.length + (usersPage.hasMore ? 1 : 0)
  const userScopes =
    ((session.user as { scopes?: string[] | null }).scopes ?? []) as readonly Scope[]
  const staffPreset = detectStaffPreset(userScopes)

  return (
    <AdminPage
      title={t('title')}
      description={t('description')}
      data-test-id="admin-overview"
    >
      <Card data-test-id="admin-overview-identity">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0 space-y-1">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]">
              {t('you.signedInAs')}
            </div>
            <div
              className="truncate text-base font-medium"
              data-test-id="admin-overview-identity-name"
            >
              {session.user.name || session.user.email}
            </div>
            {session.user.name ? (
              <div
                className="truncate text-xs text-[var(--ink-70)]"
                data-test-id="admin-overview-identity-email"
              >
                {session.user.email}
              </div>
            ) : null}
          </div>
          <Badge
            variant={staffPreset === 'iedora-admin' ? 'accent' : 'ink'}
            data-test-id="admin-overview-identity-role"
          >
            {staffPreset ?? 'staff'}
          </Badge>
        </div>
      </Card>

      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-test-id="admin-overview-cards"
      >
        <Card data-test-id="admin-overview-card-users">
          <CardTitle as="h2">{t('users.title')}</CardTitle>
          <CardDesc>
            {t('users.count', { count: totalUsers })}
          </CardDesc>
          <CardFoot>
            <Button as="a" href="/core/admin/users" variant="ghost" arrow>
              {t('users.cta')}
            </Button>
          </CardFoot>
        </Card>
        {/* admin-orgs card removed in the tenancy refactor. A follow-up
            `admin-tenants` UI will land here once the cross-product
            tenant admin surface is designed. */}
        <Card data-test-id="admin-overview-card-sessions">
          <CardTitle as="h2">{t('sessions.title')}</CardTitle>
          <CardDesc>{t('sessions.description')}</CardDesc>
          <CardFoot>
            <Button as="a" href="/core/admin/sessions" variant="ghost" arrow>
              {t('sessions.cta')}
            </Button>
          </CardFoot>
        </Card>
      </section>
    </AdminPage>
  )
}
