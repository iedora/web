import { getLocale, getTranslations } from 'next-intl/server'
import { requireActiveOrganization } from '@/features/auth'
import { canGenerateAiMenu, getOrganizationPlan } from '@/features/plans'
import { DashboardPage } from '@/shared/ui/dashboard-page'

function formatReset(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function MiscPage() {
  const { organizationId } = await requireActiveOrganization()
  const t = await getTranslations('Misc')
  const locale = await getLocale()

  const [plan, ai] = await Promise.all([
    getOrganizationPlan(organizationId),
    canGenerateAiMenu(organizationId),
  ])

  const limit = ai.limit
  const used = ai.used
  const remaining = Math.max(0, limit - used)
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

  return (
    <DashboardPage
      title={t('title')}
      eyebrow={t(`plans.${plan.code}.name`)}
      description={t('description')}
      data-test-id="misc"
    >
      <section
        className="misc-section"
        aria-label={t('aiUsageTitle')}
        data-test-id="misc-ai-usage-section"
      >
        <article
          className="billing-plan-card"
          data-test-id="misc-ai-usage-card"
        >
          <header className="billing-plan-card__head">
            <h2 className="billing-plan-card__name">{t('aiUsageTitle')}</h2>
          </header>
          <p className="billing-plan-card__tagline">{t('aiUsageTagline')}</p>

          <div
            className="misc-usage"
            data-test-id="misc-ai-usage-meter"
            data-exhausted={ai.ok ? 'false' : 'true'}
          >
            <div className="misc-usage__row">
              <span
                className="misc-usage__count"
                data-test-id="misc-ai-usage-count"
              >
                {t('usageCount', { used, limit })}
              </span>
              <span
                className="misc-usage__remaining"
                data-test-id="misc-ai-usage-remaining"
              >
                {t('remainingCount', { count: remaining })}
              </span>
            </div>
            <div
              className="misc-usage__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={used}
              aria-label={t('aiUsageTitle')}
            >
              <span
                className="misc-usage__bar-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p
              className="misc-usage__reset"
              data-test-id="misc-ai-usage-reset"
            >
              {t('resetsAt', { when: formatReset(ai.resetAt, locale) })}
            </p>
          </div>
        </article>
      </section>
    </DashboardPage>
  )
}
