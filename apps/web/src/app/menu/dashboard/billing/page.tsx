import { getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@iedora/product-menu/features/auth'
import { PLANS, getOrganizationPlan } from '@iedora/product-menu/features/plans'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'
import { Badge } from '@iedora/design-system'

/**
 * Billing — current plan + the plan ladder.
 *
 * Plan changes are handled by the iedora team (the admin BFF owns plan
 * assignment; there is no tenant-facing endpoint), so the cards are
 * informational: the active plan is marked, the recommended plan is
 * badged, and the feature lists explain what an upgrade buys. Invoices
 * moved out of the product entirely with the Go backend migration.
 *
 * The plan cards lead with a 22px restaurant-style title, a one-line
 * tagline, then a clean feature list. The current plan carries a
 * "● Active" caption — no false affordance.
 */
export default async function BillingPage() {
  // Translations are independent of auth — kick them off in parallel
  // with `requireActiveOrganization`.
  const [, t] = await Promise.all([
    requireActiveOrganization(),
    getTranslations('Billing'),
  ])

  const current = await getOrganizationPlan()

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
          const isRecommended = Boolean(plan.isRecommended)
          const restaurantsCopy =
            plan.restaurants === -1
              ? t('unlimitedRestaurants')
              : t('restaurantsCount', { count: plan.restaurants })
          const viewsCopy =
            plan.monthlyViews === -1
              ? t('unlimitedMonthlyViews')
              : t('monthlyViewsCount', { count: plan.monthlyViews })

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
                {plan.isDefault && <li>{t('unlimitedTranslations')}</li>}
                {plan.features.includes('exportPdf') && <li>{t('exportPdf')}</li>}
                {plan.features.includes('customBranding') && (
                  <li>{t('customBranding')}</li>
                )}
              </ul>
              {isCurrent && (
                <div className="billing-plan-card__action">
                  <p
                    className="billing-plan-card__current"
                    data-test-id={`billing-plan-current-${plan.code}`}
                  >
                    <span
                      aria-hidden="true"
                      className="billing-plan-card__current-dot"
                    />
                    {t('activePlan')}
                  </p>
                </div>
              )}
            </article>
          )
        })}
      </section>

      <p className="text-sm text-[var(--ink-55)]" data-test-id="billing-contact">
        {t('changePlanHint')}
      </p>
    </DashboardPage>
  )
}
