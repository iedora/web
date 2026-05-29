'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Button,
  Field,
  FieldInput,
  FieldLabel,
} from '@iedora/design-system'
import { authClient } from '@iedora/core-auth/client'
import { signUpUrl } from '@iedora/product-core/url'

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations('Core.signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL: next,
    })
    if (result.error) {
      setError(t('errorGeneric'))
      setPending(false)
      return
    }
    // better-auth handles the redirect via callbackURL. Defence in
    // depth: navigate ourselves if we're still here (e.g. callbackURL
    // was ignored due to trustedOrigin mismatch).
    window.location.assign(next)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-test-id="sign-in-password"
        />
      </Field>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
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
