import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@/features/auth'
import { getInvoiceYears, getInvoicesForYear } from '@/features/billing'
import { PLANS, getOrganizationPlan } from '@/features/plans'
import { UpgradeButton } from './upgrade-button'

function formatMoney(amountCents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amountCents / 100)
}

function formatPeriod(start: Date, end: Date, locale: string) {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
  })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

function formatIssuedAt(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { organizationId } = await requireActiveOrganization()
  const sp = await searchParams
  const t = await getTranslations('Billing')
  const tR = await getTranslations('Restaurant')
  const locale = await getLocale()

  const [current, years] = await Promise.all([
    getOrganizationPlan(organizationId),
    getInvoiceYears(organizationId),
  ])

  // Fall back to "this year" so the page is never blank for a brand-new org —
  // the empty state handles the no-invoices case explicitly.
  const currentYear = new Date().getFullYear()
  const availableYears = years.length > 0 ? years : [currentYear]
  const requested = sp.year ? Number(sp.year) : NaN
  const selectedYear =
    Number.isFinite(requested) && availableYears.includes(requested)
      ? requested
      : (availableYears[0] ?? currentYear)

  const invoices = await getInvoicesForYear(organizationId, selectedYear)

  return (
    <div className="space-y-8">
      <h1 className="flex flex-wrap items-baseline gap-2 text-sm font-normal text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          {tR('back')}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold">{t('title')}</span>
      </h1>

      <section className="space-y-3" data-testid="plan-section">
        <div>
          <h2 className="text-base font-medium">{t('currentPlanTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('currentPlanSubtitle')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => {
            const isCurrent = plan.code === current.code
            const restaurantsCopy =
              plan.limits.restaurants === Number.POSITIVE_INFINITY
                ? t('unlimitedRestaurants')
                : t('restaurantsCount', { count: plan.limits.restaurants })
            const viewsCopy =
              plan.limits.monthlyViews === Number.POSITIVE_INFINITY
                ? t('unlimitedMonthlyViews')
                : t('monthlyViewsCount', { count: plan.limits.monthlyViews })

            return (
              <div
                key={plan.code}
                data-testid={`plan-card-${plan.code}`}
                className={
                  'flex flex-col gap-4 border p-5 ' +
                  (isCurrent
                    ? 'border-foreground bg-accent/40'
                    : 'border-border bg-background')
                }
              >
                <div>
                  <div className="text-base font-semibold">
                    {t(`plans.${plan.code}.name`)}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`plans.${plan.code}.tagline`)}
                  </p>
                </div>
                <ul className="space-y-1.5 text-sm">
                  <li>· {restaurantsCopy}</li>
                  <li>· {viewsCopy}</li>
                  {/* Universal feature: only listed on the default plan so the
                    paid card stays focused on what's actually unlocked by
                    upgrading. */}
                  {plan.isDefault && <li>· {t('unlimitedTranslations')}</li>}
                  {plan.features.has('exportPdf') && <li>· {t('exportPdf')}</li>}
                  {plan.features.has('customBranding') && (
                    <li>· {t('customBranding')}</li>
                  )}
                </ul>
                <UpgradeButton
                  target={plan.code}
                  label={t(`plans.${plan.code}.cta`)}
                  current={isCurrent}
                />
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3" data-testid="invoices-section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">{t('invoicesTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('invoicesSubtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="tablist">
            {availableYears.map((year) => {
              const isSelected = year === selectedYear
              return (
                <Link
                  key={year}
                  href={`/dashboard/billing?year=${year}`}
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`year-${year}`}
                  className={
                    'border px-2.5 py-1 text-[12.5px] no-underline transition-colors ' +
                    (isSelected
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground hover:bg-foreground hover:text-background')
                  }
                >
                  {year}
                </Link>
              )
            })}
          </div>
        </div>

        {invoices.length === 0 ? (
          <div
            data-testid="invoices-empty"
            className="border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground"
          >
            {t('invoicesEmpty', { year: selectedYear })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              data-testid="invoices-table"
            >
              <thead>
                <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">{t('colIssued')}</th>
                  <th className="py-2 pr-4 font-normal">{t('colPlan')}</th>
                  <th className="py-2 pr-4 font-normal">{t('colPeriod')}</th>
                  <th className="py-2 pr-4 font-normal">{t('colAmount')}</th>
                  <th className="py-2 font-normal">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    data-testid="invoice-row"
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="py-3 pr-4">
                      {formatIssuedAt(inv.issuedAt, locale)}
                    </td>
                    <td className="py-3 pr-4">{t(`plans.${inv.plan}.name`)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {formatPeriod(inv.periodStart, inv.periodEnd, locale)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {formatMoney(inv.amountCents, inv.currency, locale)}
                    </td>
                    <td className="py-3">
                      <span
                        data-status={inv.status}
                        className={
                          'inline-flex items-center text-[11.5px] uppercase tracking-wide ' +
                          (inv.status === 'paid'
                            ? 'text-[#3d5a3a]'
                            : inv.status === 'void'
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground')
                        }
                      >
                        {t(`status.${inv.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
