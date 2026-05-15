import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@/features/auth'
import { listRestaurantsWithCounts } from '@/features/dashboard-home'
import { getOrganizationMonthlyViews } from '@/features/metrics'
import { canAddRestaurant, getOrganizationPlan } from '@/features/plans'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <span className="block font-serif text-[13px] italic text-muted-foreground">
            {t('eyebrow')}
          </span>
          <h1 className="mt-1 font-serif text-[26px] italic font-medium leading-tight tracking-tight sm:text-[32px]">
            {t('title')}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {t('subtitle')}
            <br />
            <span
              data-testid="views-meter"
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
                  data-testid="views-progress"
                  aria-hidden="true"
                  className="relative ml-2 inline-block h-1 w-20 overflow-hidden bg-border align-middle sm:w-32"
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-brand transition-[width]"
                    style={{
                      width: `${Math.min(100, (viewCount / viewLimit) * 100)}%`,
                    }}
                  />
                </span>
              )}
            </span>
            {viewsNearLimit && (
              <>
                {' '}
                <Link
                  href="/dashboard/billing"
                  data-testid="views-upgrade-nudge"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {t('viewsNudge')}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {gate.ok ? (
            <Link
              href="/onboarding"
              className="inline-flex items-center border border-foreground bg-foreground px-3.5 py-2 text-[13px] font-medium text-background no-underline transition-colors hover:bg-background hover:text-foreground"
            >
              {t('newRestaurant')}
            </Link>
          ) : (
            <Link
              href="/dashboard/billing"
              data-testid="upgrade-cta"
              className="inline-flex items-center border border-foreground px-3.5 py-2 text-[13px] font-medium text-foreground no-underline transition-colors hover:bg-foreground hover:text-background"
            >
              {tBilling('upgradeCta')}
            </Link>
          )}
        </div>
      </div>

      <EditorialList
        testId="restaurant-list"
        rows={rows}
        emptyState={
          <Card>
            <CardHeader>
              <CardTitle>{t('noRestaurants')}</CardTitle>
              <CardDescription>{t('noRestaurantsHint')}</CardDescription>
            </CardHeader>
          </Card>
        }
      />
    </div>
  )
}
