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
import { signInUrl } from '@iedora/product-core/url'

export function SignUpForm({ next }: { next: string }) {
  const t = useTranslations('Core.signUp')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const result = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: next,
    })
    if (result.error) {
      setError(t('errorGeneric'))
      setPending(false)
      return
    }
    window.location.assign(next)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
          value={name}
          onChange={(e) => setName(e.target.value)}
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-test-id="sign-up-password"
        />
        <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
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
