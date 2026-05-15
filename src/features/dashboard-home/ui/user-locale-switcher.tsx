'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { LANGUAGE_META, type LanguageCode } from '@/features/i18n'
import { setUserLocale } from '../actions'

// Compact native <select>. We deliberately don't pull in a fancy dropdown —
// the locale picker is a rare-touch control; the OS native UI is good enough
// and stays accessible by default.
export function UserLocaleSwitcher() {
  const t = useTranslations('AppHeader')
  const current = useLocale() as LanguageCode
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as LanguageCode
    if (next === current) return
    startTransition(async () => {
      await setUserLocale(next)
      router.refresh()
    })
  }

  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only">{t('language')}</span>
      <select
        value={current}
        onChange={onChange}
        disabled={pending}
        data-testid="user-locale-switcher"
        className="rounded border border-input bg-transparent px-1.5 py-0.5 text-xs"
      >
        {LANGUAGE_META.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </label>
  )
}
