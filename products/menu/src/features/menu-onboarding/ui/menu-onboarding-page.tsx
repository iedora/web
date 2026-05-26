'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Wordmark } from '@iedora/design-system'
import { MenuImportWizard } from '@/features/menu-import/ui/menu-import-wizard'

/**
 * Onboarding step that lives just after the restaurant has been
 * created. Hosts the AI menu-import wizard inline — no dialog — and
 * a "Skip" escape hatch so operators who'd rather curate the menu
 * by hand can move on to /dashboard immediately.
 *
 * Mobile-first: a single-column composition centred in `ds-shell`.
 * Editorial chrome (wordmark + serif eyebrow + paragraph) lifted from
 * the existing `/onboarding` page so the two steps feel like one
 * continuous flow.
 *
 * Success path: `<MenuImportWizard onImported />` fires once the menu
 * has been persisted; we redirect straight to `/dashboard` (instead of
 * the menu builder, which would push the user back into a chrome they
 * haven't seen yet).
 */
export function MenuOnboardingPage({
  slug,
  restaurantId,
  initialQuota,
}: {
  slug: string
  restaurantId: string
  initialQuota?: { used: number; limit: number }
}) {
  const t = useTranslations('Onboarding.menu')
  const router = useRouter()

  function goToDashboard() {
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--paper)]"
      data-test-id="menu-onboarding-page"
    >
      <main className="ds-shell flex flex-1 items-center justify-center py-12 sm:py-16">
        <div className="w-full max-w-[680px] space-y-10">
          <div className="flex flex-col items-center gap-2 text-center">
            <Link
              href="/"
              className="inline-flex items-baseline no-underline"
              aria-label="Menu home"
              data-test-id="menu-onboarding-brand-link"
            >
              <Wordmark
                word="menu"
                variant="display"
                className="ds-wordmark--reveal"
              />
            </Link>
            <span
              className="text-[17px] italic text-[var(--ink-70)]"
              style={{ fontFamily: 'var(--serif)' }}
              data-test-id="menu-onboarding-eyebrow"
            >
              {t('eyebrow')}
            </span>
          </div>

          <div className="space-y-3 text-center">
            <h1
              className="text-3xl text-[var(--ink)]"
              style={{ fontFamily: 'var(--serif)' }}
              data-test-id="menu-onboarding-title"
            >
              {t('title')}
            </h1>
            <p
              className="mx-auto max-w-prose text-sm text-[var(--ink-70)]"
              data-test-id="menu-onboarding-subtitle"
            >
              {t('subtitle')}
            </p>
          </div>

          <MenuImportWizard
            slug={slug}
            restaurantId={restaurantId}
            initialQuota={initialQuota}
            offerSetDefaultLanguage
            onImported={goToDashboard}
            extraActions={
              <Button
                type="button"
                variant="ghost"
                onClick={goToDashboard}
                data-test-id="menu-onboarding-skip"
              >
                {t('skip')}
              </Button>
            }
          />

          <p
            className="text-center text-xs text-[var(--ink-55)]"
            data-test-id="menu-onboarding-skip-hint"
          >
            {t('skipHint')}
          </p>
        </div>
      </main>
    </div>
  )
}
