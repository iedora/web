'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Button,
  Field,
  FieldInput,
  FieldLabel,
} from '@iedora/design-system'
import { signInAction, type AuthFormState } from '@iedora/product-menu/features/auth/actions'
import { signUpUrl } from '@iedora/product-menu/shared/auth-urls'

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations('Auth.signIn')
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signInAction,
    { error: null },
  )

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <Field>
        <FieldLabel htmlFor="email">{t('emailLabel')}</FieldLabel>
        <FieldInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder={t('emailPlaceholder')}
          data-test-id="sign-in-email"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">{t('passwordLabel')}</FieldLabel>
        <FieldInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={12}
          data-test-id="sign-in-password"
        />
      </Field>
      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {t('errorGeneric')}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        data-test-id="sign-in-submit"
      >
        {pending ? t('submitting') : t('submit')}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link
          href={signUpUrl(next)}
          className="underline"
          data-test-id="sign-in-sign-up-link"
        >
          {t('signUpLink')}
        </Link>
      </p>
    </form>
  )
}
