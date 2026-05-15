'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

export function LoginForm() {
  const router = useRouter()
  const t = useTranslations('Auth')
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email'))
    const password = String(formData.get('password'))

    const { error } = await authClient.signIn.email({ email, password })

    if (error) {
      setError(error.message ?? t('invalidCredentials'))
      setPending(false)
      return
    }

    router.push(next)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <span className="font-serif text-[13px] italic text-muted-foreground">
          {t('loginEyebrow')}
        </span>
        <CardTitle as="h1">{t('loginTitle')}</CardTitle>
        <CardDescription>{t('loginSubtitle')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
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
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t('loggingIn') : t('login')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <Link href="/signup" className="underline underline-offset-4">
              {t('signup')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
