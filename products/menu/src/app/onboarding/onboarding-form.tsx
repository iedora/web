'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Button,
  Card,
  CardDesc,
  CardFoot,
  CardTitle,
  Field,
  FieldInput,
  FieldLabel,
} from '@iedora/design-system'
import { completeOnboarding, type OnboardingFormState } from './actions'

/**
 * Onboarding takes ONE field — the restaurant name. The public URL
 * (slug) is generated server-side from the name with collision suffixes
 * ("sushi-place", "sushi-place-2", …) so the form isn't gating a
 * brand-new operator on choosing a URL. Slug can be changed later from
 * the restaurant settings page.
 */
export function OnboardingForm() {
  const t = useTranslations('Onboarding')
  const [state, action, pending] = useActionState<OnboardingFormState, FormData>(
    completeOnboarding,
    undefined,
  )
  const [name, setName] = useState('')

  return (
    <Card>
      <span className="font-serif text-[13px] italic text-muted-foreground">
        {t('eyebrow')}
      </span>
      <CardTitle as="h2">{t('title')}</CardTitle>
      <CardDesc>{t('subtitle')}</CardDesc>
      <form action={action}>
        <div className="space-y-4">
          <Field error={Boolean(state?.fieldErrors?.restaurantName)}>
            <FieldLabel htmlFor="restaurantName">{t('restaurantName')}</FieldLabel>
            <FieldInput
              id="restaurantName"
              name="restaurantName"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('restaurantNamePlaceholder')}
              autoFocus
            />
            {state?.fieldErrors?.restaurantName && (
              <p className="text-sm text-destructive">{state.fieldErrors.restaurantName}</p>
            )}
          </Field>
          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
        </div>
        <CardFoot>
          <Button type="submit" variant="solid" className="w-full" disabled={pending}>
            {pending ? t('creating') : t('create')}
          </Button>
        </CardFoot>
      </form>
    </Card>
  )
}
