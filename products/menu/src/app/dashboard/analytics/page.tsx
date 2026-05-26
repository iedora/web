import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@/features/auth'
import {
  getOrganizationAnalytics,
  isAnalyticsRange,
  type AnalyticsRange,
} from '@/features/metrics'
import { getOrganizationPlan, planHas } from '@/features/plans'
import { KpiCard, ScansCard, ScansChart } from '@/features/dashboard-home/ui/analytics-cards'
import { DashboardPage } from '@/shared/ui/dashboard-page'

const DEFAULT_RANGE: AnalyticsRange = '30d'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const { organizationId } = await requireActiveOrganization()
  const plan = await getOrganizationPlan(organizationId)

  // Free plans hit billing — analytics is the headline upgrade hook for Casa,
  // so funneling there is the right next step rather than a half-empty page.
  if (!planHas(plan, 'analytics')) redirect('/dashboard/billing')

  const sp = await searchParams
  const t = await getTranslations('Analytics')
  const tDash = await getTranslations('Dashboard')
  const locale = await getLocale()

  const range: AnalyticsRange =
    sp.range && isAnalyticsRange(sp.range) ? sp.range : DEFAULT_RANGE

  const analytics = await getOrganizationAnalytics(organizationId, range)
  const numberFmt = new Intl.NumberFormat(locale)

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
              paused: analytics.menus.paused,
            })}
          />
          <KpiCard
            testId="analytics-dishes"
            eyebrow={tDash('analytics.dishesLabel')}
            value={numberFmt.format(analytics.dishes.total)}
            caption={
              analytics.dishes.lastAddedAt
                ? tDash('analytics.dishesCaption', {
                    time: new Intl.DateTimeFormat(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(analytics.dishes.lastAddedAt),
                  })
                : tDash('analytics.dishesNone')
            }
          />
          <KpiCard
            testId="analytics-languages"
            eyebrow={tDash('analytics.languagesLabel')}
            value={numberFmt.format(analytics.languageCodes.length)}
            caption={
              analytics.languageCodes.length > 0
                ? analytics.languageCodes
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
