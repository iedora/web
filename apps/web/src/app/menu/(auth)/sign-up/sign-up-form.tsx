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
import { signUpAction, type AuthFormState } from '@iedora/product-menu/features/auth/actions'
import { signInUrl } from '@iedora/product-menu/shared/auth-urls'

export function SignUpForm({ next }: { next: string }) {
  const t = useTranslations('Auth.signUp')
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signUpAction,
    { error: null },
  )

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <Field>
        <FieldLabel htmlFor="name">{t('nameLabel')}</FieldLabel>
        <FieldInput
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          maxLength={80}
          autoFocus
          placeholder={t('namePlaceholder')}
          data-test-id="sign-up-name"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="email">{t('emailLabel')}</FieldLabel>
        <FieldInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t('emailPlaceholder')}
          data-test-id="sign-up-email"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">{t('passwordLabel')}</FieldLabel>
        <FieldInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          data-test-id="sign-up-password"
        />
        <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
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
        data-test-id="sign-up-submit"
      >
        {pending ? t('submitting') : t('submit')}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link
          href={signInUrl(next)}
          className="underline"
          data-test-id="sign-up-sign-in-link"
        >
          {t('signInLink')}
        </Link>
      </p>
    </form>
  )
}
