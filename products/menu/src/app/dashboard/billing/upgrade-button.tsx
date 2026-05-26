'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@iedora/design-system'
import { setOrganizationPlan } from '@/features/plans/actions'
import type { PlanCode } from '@/features/plans'

/**
 * Plan-switch button rendered at the bottom of each plan card.
 *
 * Button hierarchy is explicit:
 *   - **Current plan**  → rendered as a state, NOT a button. A
 *                          cinnabar dot + "Active" caption replaces the
 *                          old disabled-looking button so the operator
 *                          doesn't waste a tap on something inert.
 *   - **Recommended**    → primary solid (ink fill, paper text).
 *   - **Downgrade / alt**→ outlined (ink border, transparent fill).
 *
 * The previous version painted every state as a solid button — current
 * just disabled — which read as "this is broken" to a 30–70 yo. The
 * new distinction makes intent obvious at a glance.
 */
export function UpgradeButton({
  target,
  label,
  current,
  recommended = false,
}: {
  target: PlanCode
  label: string
  current: boolean
  recommended?: boolean
}) {
  const t = useTranslations('Billing')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (current) {
    return (
      <p
        className="billing-plan-card__current"
        data-test-id={`billing-plan-current-${target}`}
      >
        <span aria-hidden="true" className="billing-plan-card__current-dot" />
        {t('activePlan')}
      </p>
    )
  }

  return (
    <Button
      // Recommended = primary (solid ink fill); everything else is the
      // default outlined variant so the visual stack tells the operator
      // which plan to take if they're not sure.
      variant={recommended ? 'solid' : undefined}
      className="w-full"
      disabled={pending}
      data-test-id={`billing-plan-switch-${target}`}
      onClick={() =>
        startTransition(async () => {
          await setOrganizationPlan(target)
          router.refresh()
        })
      }
    >
      {pending ? t('switching') : label}
    </Button>
  )
}
