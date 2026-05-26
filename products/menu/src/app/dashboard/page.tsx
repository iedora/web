import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@/features/auth'
import { listRestaurantsWithCounts } from '@/features/dashboard-home'
import { getOrganizationMonthlyViews } from '@/features/metrics'
import { canAddRestaurant, getOrganizationPlan } from '@/features/plans'
import { Card, CardDesc, CardTitle } from '@iedora/design-system'
import { DashboardPage as PageShell } from '@/shared/ui/dashboard-page'
import {
  EditorialList,
  formatEditedAt,
  formatIndex,
  type EditorialRowData,
} from '@/shared/ui/editorial-list'

const VIEW_NUDGE_RATIO = 0.8

export default async function DashboardPage() {
  const { organizationId } = await requireActiveOrganization()
  const t = await getTranslations('Dashboard')
  const tBilling = await getTranslations('Billing')
  const locale = await getLocale()

  const [restaurants, gate, plan, viewCount] = await Promise.all([
    listRestaurantsWithCounts(organizationId),
    canAddRestaurant(organizationId),
    getOrganizationPlan(organizationId),
    getOrganizationMonthlyViews(organizationId),
  ])

  const viewLimit = plan.limits.monthlyViews
  const isUnlimitedViews = !Number.isFinite(viewLimit)
  const viewsNearLimit =
    !isUnlimitedViews && viewCount / viewLimit >= VIEW_NUDGE_RATIO
  const numberFmt = new Intl.NumberFormat(locale)

  const showIndex = restaurants.length > 1
  const rows: EditorialRowData[] = restaurants.map((r, i) => ({
    id: r.id,
    href: `/dashboard/r/${r.slug}`,
    title: r.name,
    index: showIndex ? formatIndex(i + 1) : undefined,
    subtitle: (
      <>
        <span className="text-muted-foreground">/r/{r.slug}</span>
        <span aria-hidden="true">·</span>
        <span>{t('editedAt', { when: formatEditedAt(r.updatedAt, locale) })}</span>
      </>
    ),
    metadata: `${t('menuCount', { count: r.menuCount })} · ${t('dishCount', { count: r.dishCount })}`,
    actions: [
      { key: 'menus', label: t('actionMenus'), href: `/dashboard/r/${r.slug}` },
      { key: 'theme', label: t('actionTheme'), href: `/dashboard/r/${r.slug}/theme` },
      { key: 'qr', label: t('actionQr'), href: `/dashboard/r/${r.slug}/qr` },
    ],
  }))

  const description = (
    <>
      {t('subtitle')}
      <br />
      <span
        data-test-id="dashboard-views-meter"
        data-near-limit={viewsNearLimit ? 'true' : 'false'}
      >
        {isUnlimitedViews
          ? t('viewsUnlimited', { count: numberFmt.format(viewCount) })
          : t('viewsCount', {
              count: numberFmt.format(viewCount),
              limit: numberFmt.format(viewLimit),
            })}{' '}
        {t('viewsThisMonth')}
        {!isUnlimitedViews && (
          <span
            data-test-id="dashboard-views-progress"
            aria-hidden="true"
            className="relative ml-2 inline-block h-1 w-20 overflow-hidden bg-[var(--ink-14)] align-middle sm:w-32"
          >
            <span
              className="absolute inset-y-0 left-0 bg-[var(--cinnabar)] transition-[width]"
              style={{ width: `${Math.min(100, (viewCount / viewLimit) * 100)}%` }}
            />
          </span>
        )}
      </span>
      {viewsNearLimit && (
        <>
          {' '}
          <Link
            href="/dashboard/billing"
            data-test-id="dashboard-views-upgrade-nudge"
            className="font-medium text-[var(--ink)] underline-offset-4 hover:underline"
          >
            {t('viewsNudge')}
          </Link>
        </>
      )}
    </>
  )

  const actions = gate.ok ? (
    <Link
      href="/onboarding"
      data-test-id="dashboard-new-restaurant"
      className="inline-flex items-center border border-[var(--ink)] bg-[var(--ink)] px-3.5 py-2 text-[13px] font-medium text-[var(--paper)] no-underline transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)]"
    >
      {t('newRestaurant')}
    </Link>
  ) : (
    <Link
      href="/dashboard/billing"
      data-test-id="dashboard-upgrade-cta"
      className="inline-flex items-center border border-[var(--ink)] px-3.5 py-2 text-[13px] font-medium text-[var(--ink)] no-underline transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
    >
      {tBilling('upgradeCta')}
    </Link>
  )

  return (
    <PageShell
      data-test-id="dashboard-home"
      title={t('title')}
      eyebrow={t('eyebrow')}
      description={description}
      actions={actions}
    >
      <EditorialList
        testId="restaurant-list"
        rows={rows}
        emptyState={
          <Card>
            <CardTitle>{t('noRestaurants')}</CardTitle>
            <CardDesc>{t('noRestaurantsHint')}</CardDesc>
          </Card>
        }
      />
    </PageShell>
  )
}
