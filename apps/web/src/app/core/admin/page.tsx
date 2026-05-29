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
import { SCOPES } from '@iedora/core-auth/scopes'
import {
  detectStaffPreset,
  STAFF_ROLE_PRESETS,
  STAFF_ROLES,
  IEDORA_ADMIN_ROLE,
} from '@iedora/core-auth'
import type { Scope } from '@iedora/core-auth/scopes'
import { listUsers } from '@iedora/core-auth/server'
import {
  drizzleAdminTenantsGateway,
  listTenants,
} from '@iedora/product-core/features/admin-tenants'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'
import {
  ScopeList,
  PresetHeader,
} from '@iedora/product-core/shared/ui/scope-matrix'

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

  // Cheap aggregates — both list helpers paginate; we just probe a
  // single row + the `hasMore`/`total` hint.
  const usersPage = await listUsers({ limit: 1 })
  const totalUsers = usersPage.users.length + (usersPage.hasMore ? 1 : 0)
  const tenantsPage = await listTenants(drizzleAdminTenantsGateway(), {
    page: 1,
    pageSize: 1,
    sortBy: 'createdAt',
    sortDirection: 'desc',
  })
  const totalTenants = tenantsPage.total
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
        className="grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3"
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
        <Card data-test-id="admin-overview-card-tenants">
          <CardTitle as="h2">{t('tenants.title')}</CardTitle>
          <CardDesc>{t('tenants.count', { count: totalTenants })}</CardDesc>
          <CardFoot>
            <Button as="a" href="/core/admin/tenants" variant="ghost" arrow>
              {t('tenants.cta')}
            </Button>
          </CardFoot>
        </Card>
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

      <section
        className="space-y-4"
        aria-labelledby="admin-overview-presets-h"
        data-test-id="admin-overview-presets"
      >
        <header className="space-y-1">
          <h2
            id="admin-overview-presets-h"
            className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]"
          >
            {t('presets.heading')}
          </h2>
          <p className="text-sm text-[var(--ink-70)] max-w-prose">
            {t('presets.description')}
          </p>
        </header>
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
          {STAFF_ROLES.map((roleKey) => {
            const scopes = STAFF_ROLE_PRESETS[roleKey]
            return (
              <Card
                key={roleKey}
                data-test-id={`admin-overview-preset-${roleKey}`}
              >
                <PresetHeader
                  name={roleKey}
                  scopeCount={scopes.length}
                  sourceLabel={t('presets.sourceBuiltIn')}
                  highlight={roleKey === IEDORA_ADMIN_ROLE}
                />
                <div className="mt-4">
                  <ScopeList
                    scopes={scopes as readonly string[]}
                    emptyLabel={t('presets.emptyScopes')}
                    data-test-id={`admin-overview-preset-${roleKey}-scopes`}
                  />
                </div>
              </Card>
            )
          })}
        </div>
      </section>
    </AdminPage>
  )
}
