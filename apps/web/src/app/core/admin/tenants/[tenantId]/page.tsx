import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Badge, Card, CardDesc, CardTitle } from '@iedora/design-system'
import { requireScope } from '@iedora/product-core'
import {
  drizzleAdminTenantsGateway,
  getTenant,
} from '@iedora/product-core/features/admin-tenants'
import { SCOPES } from '@iedora/auth/scopes'
import { detectTenantPreset } from '@iedora/auth'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'
import { listTenantProductStates } from '@iedora/core-tenancy'
import { PRODUCT_ONBOARDING_STATUSES } from '@iedora/brand'

/**
 * Tenant detail — three stacked sections:
 *
 *   1. Identity card (id, created, member count snapshot)
 *   2. Members table — each membership row with its scope-preset
 *      label (or "Custom" when the scope set doesn't match a
 *      preset).
 *   3. Subscriptions table — one row per product the tenant is
 *      enrolled in (Stripe-shape status, period dates).
 *
 * Read-only today. Mutation surface (kick member, change subscription,
 * delete tenant) lands when the corresponding `staff.core.tenants.*`
 * + `staff.core.members.*` actions ship.
 */

type Params = { tenantId: string }

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  await requireScope(SCOPES.core.staff.tenants.get)
  const t = await getTranslations('Core.admin.tenants.detail')

  const { tenantId } = await params
  const detail = await getTenant(drizzleAdminTenantsGateway(), tenantId)
  if (!detail) notFound()

  const { tenant, members, subscriptions } = detail
  const productStates = await listTenantProductStates(tenantId)
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <AdminPage
      crumbs={[
        { label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' },
        { label: t('crumbTenants'), href: '/core/admin/tenants', testId: 'tenants' },
      ]}
      title={tenant.name}
      description={t('description')}
      data-test-id={`admin-tenant-${tenant.id}`}
    >
      <Card data-test-id="admin-tenant-identity">
        <CardTitle as="h2">{t('identity.heading')}</CardTitle>
        <CardDesc>
          <div className="space-y-1.5">
            <Row label={t('identity.id')}>
              <span className="font-[family-name:var(--mono)] text-[12.5px]">
                {tenant.id}
              </span>
            </Row>
            <Row label={t('identity.created')}>
              <span className="tabular-nums">{dateFmt.format(tenant.createdAt)}</span>
            </Row>
            <Row label={t('identity.members')}>
              <span className="tabular-nums">{tenant.memberCount}</span>
            </Row>
          </div>
        </CardDesc>
      </Card>

      <section
        className="space-y-3"
        aria-labelledby="admin-tenant-members-h"
        data-test-id="admin-tenant-members"
      >
        <h2
          id="admin-tenant-members-h"
          className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]"
        >
          {t('members.heading')}
        </h2>
        {members.length === 0 ? (
          <Card data-test-id="admin-tenant-members-empty">
            <CardDesc>{t('members.empty')}</CardDesc>
          </Card>
        ) : (
          <div className="border border-[var(--ink-14)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ink-04)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)]">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">
                    {t('members.colUser')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t('members.colPreset')}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t('members.colJoined')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const preset = detectTenantPreset(m.scopes)
                  return (
                    <tr
                      key={m.id}
                      className="border-t border-[var(--ink-08)]"
                      data-test-id={`admin-tenant-member-${m.id}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{m.userName}</div>
                        <div className="font-[family-name:var(--mono)] text-[11px] text-[var(--ink-55)]">
                          {m.userEmail}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={preset ? 'ink' : 'ghost'}>
                          {preset ?? t('members.presetCustom')}
                        </Badge>
                        <div className="mt-1 text-[11px] text-[var(--ink-40)]">
                          {t('members.scopeCount', { count: m.scopes.length })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--ink-70)] tabular-nums">
                        {dateFmt.format(m.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="space-y-3"
        aria-labelledby="admin-tenant-subs-h"
        data-test-id="admin-tenant-subscriptions"
      >
        <h2
          id="admin-tenant-subs-h"
          className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]"
        >
          {t('subscriptions.heading')}
        </h2>
        {subscriptions.length === 0 ? (
          <Card data-test-id="admin-tenant-subscriptions-empty">
            <CardDesc>{t('subscriptions.empty')}</CardDesc>
          </Card>
        ) : (
          <div className="border border-[var(--ink-14)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ink-04)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)]">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">
                    {t('subscriptions.colProduct')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t('subscriptions.colPlan')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t('subscriptions.colStatus')}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t('subscriptions.colPeriod')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-[var(--ink-08)]"
                    data-test-id={`admin-tenant-sub-${s.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{s.product}</td>
                    <td className="px-4 py-3">{s.plan}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                      {s.cancelAtPeriodEnd ? (
                        <div className="mt-1 text-[11px] text-[var(--cinnabar)]">
                          {t('subscriptions.willCancel')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ink-70)] tabular-nums">
                      {s.currentPeriodEnd
                        ? dateFmt.format(s.currentPeriodEnd)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="space-y-3"
        aria-labelledby="admin-tenant-products-h"
        data-test-id="admin-tenant-products"
      >
        <h2
          id="admin-tenant-products-h"
          className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]"
        >
          {t('products.heading')}
        </h2>
        {productStates.length === 0 ? (
          <Card data-test-id="admin-tenant-products-empty">
            <CardDesc>{t('products.empty')}</CardDesc>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {productStates.map((s) => (
              <Card
                key={s.product}
                data-test-id={`admin-tenant-product-${s.product}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <CardTitle as="h3">{t(`products.label.${s.product}`)}</CardTitle>
                  <Badge variant={productStateVariant(s.status)}>
                    {t(`products.status.${s.status}`)}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1.5">
                  <Row label={t('products.col.currentStep')}>
                    <span>{s.currentStep ?? '—'}</span>
                  </Row>
                  <Row label={t('products.col.startedAt')}>
                    <span className="tabular-nums">{dateFmt.format(s.startedAt)}</span>
                  </Row>
                  <Row label={t('products.col.completedAt')}>
                    <span className="tabular-nums">
                      {s.completedAt ? dateFmt.format(s.completedAt) : '—'}
                    </span>
                  </Row>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </AdminPage>
  )
}

function productStateVariant(
  status: string,
): 'live' | 'accent' | 'ghost' | 'ink' {
  if (status === PRODUCT_ONBOARDING_STATUSES.completed) return 'live'
  if (status === PRODUCT_ONBOARDING_STATUSES.inProgress) return 'accent'
  if (status === PRODUCT_ONBOARDING_STATUSES.skipped) return 'ghost'
  return 'ink'
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-40)]">
        {label}
      </span>
      <span>{children}</span>
    </div>
  )
}

function statusVariant(
  status: string,
): 'live' | 'accent' | 'ghost' | 'ink' {
  if (status === 'active' || status === 'trialing') return 'live'
  if (status === 'past_due' || status === 'unpaid') return 'accent'
  if (status === 'cancelled' || status === 'incomplete_expired') return 'ghost'
  return 'ink'
}
