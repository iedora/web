'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Button,
  DottedStepper,
  Masthead,
  OrnamentRule,
  PaperCard,
  Stage,
} from '@iedora/design-system'
import { seedSampleMenu } from '../../menu-builder/actions'

/**
 * Step 2 chrome — paper-card masthead + dotted stepper + ornament,
 * then the first-menu choice: seed a sample menu (primary) or skip
 * straight to the dashboard and build by hand.
 *
 * All page chrome (Stage, PaperCard, Masthead, OrnamentRule,
 * DottedStepper) comes from @iedora/design-system primitives so the
 * onboarding flow stays in lockstep with every other paper-card
 * surface.
 *
 * Form-specific classes (`onb-lede`, `onb-wizard-mount`, `onb-linkbtn`,
 * `onb-undernote`) live in `apps/web/src/app/menu/onboarding/onboarding.css`
 * — imported by the route entry that renders this component.
 */
export function MenuOnboardingPage({
  slug,
  onComplete,
}: {
  slug: string
  /**
   * Fired before the redirect on both completion paths (Seed + Skip).
   * The route entry passes the server action that flips
   * `restaurant.onboarding_completed_at` so the resume gate at
   * `/menu/onboarding` stops bouncing this user back into the wizard.
   * Optional so unit tests keep working without a fake.
   */
  onComplete?: () => Promise<void>
}) {
  const t = useTranslations('Onboarding')
  const tMenu = useTranslations('Onboarding.menu')
  const tRestaurant = useTranslations('Restaurant')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function complete() {
    if (onComplete) {
      try {
        await onComplete()
      } catch (err) {
        // Best-effort: a flag-write failure must not block the
        // redirect. The operator gets a stale resume bounce next
        // time at worst; surface in the console for ops visibility.
        console.error('[menu-onboarding] markComplete failed', err)
      }
    }
  }

  function seed() {
    startTransition(async () => {
      const res = await seedSampleMenu(slug)
      await complete()
      if ('ok' in res) {
        router.push(`/menu/dashboard/r/${slug}/m/${res.menuId}`)
      } else {
        router.push('/menu/dashboard')
      }
      router.refresh()
    })
  }

  function skip() {
    startTransition(async () => {
      await complete()
      router.push('/menu/dashboard')
      router.refresh()
    })
  }

  return (
    <Stage data-test-id="menu-onboarding-page">
      <PaperCard data-test-id="menu-onboarding-card">
        <Masthead course={tMenu('eyebrow')} />
        <DottedStepper
          steps={[
            { key: 'name', index: 1, label: t('steps.name') },
            { key: 'menu', index: 2, label: t('steps.menu') },
          ]}
          currentKey="menu"
          ariaLabel={t('steps.label')}
          counterLabel={t('steps.counter', { index: 2, total: 2 })}
          testId="menu-onboarding-stepper"
          stepTestId={(key) => `menu-onboarding-stepper-step-${key}`}
        />
        <OrnamentRule fleuron="❧" />

        <div className="onb-lede">
          <h1 data-test-id="menu-onboarding-title">{tMenu('title')}</h1>
          <p data-test-id="menu-onboarding-subtitle">
            {tMenu('subtitle')} <em>{tMenu('subtitleAside')}</em>
          </p>
        </div>

        <div className="onb-wizard-mount">
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={seed}
            data-test-id="menu-onboarding-seed"
          >
            {tRestaurant('sampleMenu')}
          </Button>
          <button
            type="button"
            className="onb-linkbtn"
            onClick={skip}
            disabled={pending}
            data-test-id="menu-onboarding-skip"
          >
            {tMenu('skip')}
          </button>
        </div>

        <p
          className="onb-undernote"
          data-test-id="menu-onboarding-skip-hint"
        >
          {tMenu('skipHint')}
        </p>
      </PaperCard>
    </Stage>
  )
}
