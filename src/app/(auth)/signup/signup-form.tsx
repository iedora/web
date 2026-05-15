'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { authClient } from '@/features/auth/client'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

export function SignupForm() {
  const router = useRouter()
  const t = useTranslations('Auth')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const formData = new FormData(event.currentTarget)
    const name = String(formData.get('name'))
    const email = String(formData.get('email'))
    const password = String(formData.get('password'))

    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
    })

    if (error) {
      setError(error.message ?? t('couldNotCreate'))
      setPending(false)
      return
    }

    router.push('/onboarding')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <span className="font-serif text-[13px] italic text-muted-foreground">
          {t('signupEyebrow')}
        </span>
        <CardTitle as="h1">{t('signupTitle')}</CardTitle>
        <CardDescription>{t('signupSubtitle')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('name')}</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder={t('namePlaceholder')}
              required
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t('emailPlaceholder')}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t('creatingAccount') : t('signup')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('alreadyHaveAccount')}{' '}
            <Link href="/login" className="underline underline-offset-4">
              {t('login')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
