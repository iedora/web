import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@iedora/product-menu/features/auth'
import {
  getOrganizationAnalytics,
  isAnalyticsRange,
  type AnalyticsRange,
} from '@iedora/product-menu/features/metrics'
import { getOrganizationPlan, planHas } from '@iedora/product-menu/features/plans'
import { KpiCard, ScansCard, ScansChart } from '@iedora/product-menu/features/dashboard-home/ui/analytics-cards'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'

const DEFAULT_RANGE: AnalyticsRange = '30d'

// Cached formatter pools — one Intl.* per locale instead of one per render.
const NUMBER_FMT_CACHE = new Map<string, Intl.NumberFormat>()
function numberFormat(locale: string) {
  let fmt = NUMBER_FMT_CACHE.get(locale)
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale)
    NUMBER_FMT_CACHE.set(locale, fmt)
  }
  return fmt
}

const TIME_FMT_CACHE = new Map<string, Intl.DateTimeFormat>()
function timeFormat(locale: string) {
  let fmt = TIME_FMT_CACHE.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    TIME_FMT_CACHE.set(locale, fmt)
  }
  return fmt
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  // searchParams + i18n are independent of auth — fan out. `plan` chains
  // off the same cached `requireActiveOrganization` promise.
  const orgPromise = requireActiveOrganization()
  const [, plan, sp, t, tDash, locale] = await Promise.all([
    orgPromise,
    orgPromise.then(() => getOrganizationPlan()),
    searchParams,
    getTranslations('Analytics'),
    getTranslations('Dashboard'),
    getLocale(),
  ])

  // Free plans hit billing — analytics is the headline upgrade hook for Casa,
  // so funneling there is the right next step rather than a half-empty page.
  if (!planHas(plan, 'analytics')) redirect('/menu/dashboard/billing')

  const range: AnalyticsRange =
    sp.range && isAnalyticsRange(sp.range) ? sp.range : DEFAULT_RANGE

  const analytics = await getOrganizationAnalytics(range)
  const numberFmt = numberFormat(locale)

  const peakValue = analytics.dailyBreakdown.reduce(
    (m, p) => (p.count > m ? p.count : m),
    0,
  )

  const rangeTabs = (
    <div className="flex items-center gap-1" role="tablist">
      {(['today', '7d', '30d'] as const).map((r) => {
        const isSelected = r === range
        return (
          <Link
            key={r}
            href={`/dashboard/analytics?range=${r}`}
            role="tab"
            aria-selected={isSelected}
            data-test-id={`analytics-range-${r}`}
            className={
              'border px-2.5 py-1 text-[12.5px] no-underline transition-colors ' +
              (isSelected
                ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
                : 'border-[var(--ink-40)] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)]')
            }
          >
            {tDash(`analytics.range.${r}`)}
          </Link>
        )
      })}
    </div>
  )

  return (
    <DashboardPage
      title={t('title')}
      data-test-id="analytics"
      actions={rangeTabs}
    >
      <section className="space-y-4" data-test-id="analytics-block">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ScansCard
            range={range}
            total={analytics.totalScans}
            today={analytics.todayScans}
            breakdown={analytics.dailyBreakdown}
            labels={{
              eyebrow: tDash(`analytics.scansEyebrow.${range}`),
              tagline: tDash('analytics.scansTagline', {
                today: numberFmt.format(analytics.todayScans),
              }),
            }}
          />
          <KpiCard
            testId="analytics-menus"
            eyebrow={tDash('analytics.menusLabel')}
            value={numberFmt.format(analytics.menus.total)}
            caption={tDash('analytics.menusCaption', {
              active: analytics.menus.active,
              paused: analytics.menus.total - analytics.menus.active,
            })}
          />
          <KpiCard
            testId="analytics-dishes"
            eyebrow={tDash('analytics.dishesLabel')}
            value={numberFmt.format(analytics.dishes.total)}
            caption={
              analytics.dishes.lastAddedAt
                ? tDash('analytics.dishesCaption', {
                    time: timeFormat(locale).format(new Date(analytics.dishes.lastAddedAt)),
                  })
                : tDash('analytics.dishesNone')
            }
          />
          <KpiCard
            testId="analytics-languages"
            eyebrow={tDash('analytics.languagesLabel')}
            value={numberFmt.format(analytics.languages.length)}
            caption={
              analytics.languages.length > 0
                ? analytics.languages
                    .map((c) => c.toUpperCase())
                    .join(' · ')
                : tDash('analytics.noData')
            }
          />
        </div>

        <ScansChart
          breakdown={analytics.dailyBreakdown}
          eyebrow={tDash(`analytics.chartEyebrow.${range}`)}
          peakLabel={
            peakValue > 0
              ? tDash('analytics.chartPeak', {
                  count: numberFmt.format(peakValue),
                })
              : null
          }
          locale={locale}
        />
      </section>
    </DashboardPage>
  )
}
