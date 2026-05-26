import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@/features/auth'
import { getInvoiceYears, getInvoicesForYear } from '@/features/billing'
import { PLANS, getOrganizationPlan } from '@/features/plans'
import { DashboardPage } from '@/shared/ui/dashboard-page'
import { Badge } from '@iedora/design-system'
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

/**
 * Billing — plan + invoices.
 *
 * Mobile-first redesign:
 *
 *   1. The plan cards lead with a 22px restaurant-style title, a one-line
 *      tagline, then a clean feature list. The current plan replaces its
 *      button with a "● Active" caption — no false affordance. The
 *      recommended plan keeps its primary solid CTA, the alternative
 *      plans drop to the default outlined variant. The hierarchy is
 *      readable at a glance, in any age group.
 *   2. Invoices: card list, not a table. A wide table on a phone forces
 *      horizontal scroll or shrinks the type below the floor. One
 *      invoice = one card with date / plan / amount / status — works on
 *      a 360px screen the same way it works on a 27" monitor.
 *   3. Year switcher: small chips that match the editor's section
 *      chips.
 *   4. No horizontal rules. The page lays itself out on whitespace +
 *      card borders.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { organizationId } = await requireActiveOrganization()
  const sp = await searchParams
  const t = await getTranslations('Billing')
  const locale = await getLocale()

  const [current, years] = await Promise.all([
    getOrganizationPlan(organizationId),
    getInvoiceYears(organizationId),
  ])

  const currentYear = new Date().getFullYear()
  const availableYears = years.length > 0 ? years : [currentYear]
  const requested = sp.year ? Number(sp.year) : NaN
  const selectedYear =
    Number.isFinite(requested) && availableYears.includes(requested)
      ? requested
      : (availableYears[0] ?? currentYear)

  const invoices = await getInvoicesForYear(organizationId, selectedYear)

  return (
    <DashboardPage
      title={t('title')}
      eyebrow={t(`plans.${current.code}.name`)}
      data-test-id="billing"
    >
      <section
        className="billing-plans"
        data-test-id="billing-plan-section"
        aria-label={t('currentPlanTitle')}
      >
        {PLANS.map((plan) => {
          const isCurrent = plan.code === current.code
          const isRecommended = plan.code === 'casa'
          const restaurantsCopy =
            plan.limits.restaurants === Number.POSITIVE_INFINITY
              ? t('unlimitedRestaurants')
              : t('restaurantsCount', { count: plan.limits.restaurants })
          const viewsCopy =
            plan.limits.monthlyViews === Number.POSITIVE_INFINITY
              ? t('unlimitedMonthlyViews')
              : t('monthlyViewsCount', { count: plan.limits.monthlyViews })
          const aiCopy = t('aiMenuGenerationsPerWeek', {
            count: plan.limits.aiMenuGenerationsPerWeek,
          })

          return (
            <article
              key={plan.code}
              data-test-id={`billing-plan-card-${plan.code}`}
              data-current={isCurrent ? 'true' : 'false'}
              data-recommended={isRecommended ? 'true' : 'false'}
              className="billing-plan-card"
            >
              <header className="billing-plan-card__head">
                <h2 className="billing-plan-card__name">
                  {t(`plans.${plan.code}.name`)}
                </h2>
                {isRecommended && !isCurrent && (
                  <Badge variant="live">
                    {t(`plans.${plan.code}.badge`)}
                  </Badge>
                )}
              </header>
              <p className="billing-plan-card__tagline">
                {t(`plans.${plan.code}.tagline`)}
              </p>
              <ul className="billing-plan-card__features">
                <li>{restaurantsCopy}</li>
                <li>{viewsCopy}</li>
                <li>{aiCopy}</li>
                {plan.isDefault && <li>{t('unlimitedTranslations')}</li>}
                {plan.features.has('exportPdf') && <li>{t('exportPdf')}</li>}
                {plan.features.has('customBranding') && (
                  <li>{t('customBranding')}</li>
                )}
              </ul>
              <div className="billing-plan-card__action">
                <UpgradeButton
                  target={plan.code}
                  label={t(`plans.${plan.code}.cta`)}
                  current={isCurrent}
                  recommended={isRecommended}
                />
              </div>
            </article>
          )
        })}
      </section>

      <section
        className="billing-invoices"
        data-test-id="billing-invoices-section"
        aria-label={t('invoicesTitle')}
      >
        <header className="billing-invoices__head">
          <div>
            <h2 className="billing-invoices__title">{t('invoicesTitle')}</h2>
            <p className="billing-invoices__subtitle">
              {t('invoicesSubtitle')}
            </p>
          </div>
          <nav
            className="billing-invoices__years"
            aria-label={t('invoicesYearAria')}
          >
            {availableYears.map((year) => {
              const isSelected = year === selectedYear
              return (
                <Link
                  key={year}
                  href={`/dashboard/billing?year=${year}`}
                  aria-current={isSelected ? 'page' : undefined}
                  data-active={isSelected ? 'true' : 'false'}
                  data-test-id={`billing-year-${year}`}
                  className="billing-invoices__year"
                >
                  {year}
                </Link>
              )
            })}
          </nav>
        </header>

        {invoices.length === 0 ? (
          <p
            data-test-id="billing-invoices-empty"
            className="billing-invoices__empty"
          >
            {t('invoicesEmpty', { year: selectedYear })}
          </p>
        ) : (
          <ul
            className="billing-invoice-list"
            data-test-id="billing-invoices-table"
          >
            {invoices.map((inv) => (
              <li
                key={inv.id}
                data-test-id={`billing-invoice-row-${inv.id}`}
                className="billing-invoice"
              >
                <div className="billing-invoice__top">
                  <span className="billing-invoice__date">
                    {formatIssuedAt(inv.issuedAt, locale)}
                  </span>
                  <span
                    className="billing-invoice__status"
                    data-status={inv.status}
                  >
                    {t(`status.${inv.status}`)}
                  </span>
                </div>
                <p className="billing-invoice__plan">
                  {t(`plans.${inv.plan}.name`)}
                  <span aria-hidden="true"> · </span>
                  <span className="billing-invoice__period">
                    {formatPeriod(inv.periodStart, inv.periodEnd, locale)}
                  </span>
                </p>
                <p className="billing-invoice__amount">
                  {formatMoney(inv.amountCents, inv.currency, locale)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DashboardPage>
  )
}
