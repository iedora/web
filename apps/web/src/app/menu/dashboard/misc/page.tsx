import { getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@iedora/product-menu/features/auth'
import { getOrganizationPlan } from '@iedora/product-menu/features/plans'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'

/**
 * Misc — account odds-and-ends. The AI menu-import usage meter that
 * used to live here was removed with the AI features; what remains is
 * the plan eyebrow + description shell for future account widgets.
 */
export default async function MiscPage() {
  // i18n is independent of auth — fan out. `plan` chains off the same
  // cached org promise.
  const orgPromise = requireActiveOrganization()
  const [, t, plan] = await Promise.all([
    orgPromise,
    getTranslations('Misc'),
    orgPromise.then(() => getOrganizationPlan()),
  ])

  return (
    <DashboardPage
      title={t('title')}
      eyebrow={t(`plans.${plan.code}.name`)}
      description={t('description')}
      data-test-id="misc"
    >
      {null}
    </DashboardPage>
  )
}
