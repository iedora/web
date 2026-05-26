'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { LANGUAGE_META, type LanguageCode } from '@/features/i18n'
import { setUserLocale } from '../actions'

/**
 * Inline locale buttons — one per registered language, mono-caps so they
 * sit beside the rest of the chrome (logout, breadcrumbs). The current
 * locale is `data-active="true"` and `aria-pressed="true"` so the chrome
 * E2E specs can assert on it; the same attributes drive the cinnabar
 * underline through the regular `.ds-nav__link` rules.
 */
export function UserLocaleSwitcher() {
  const t = useTranslations('AppHeader')
  const current = useLocale() as LanguageCode
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function select(next: LanguageCode) {
    if (next === current || pending) return
    startTransition(async () => {
      await setUserLocale(next)
      router.refresh()
    })
  }

  return (
    <div
      className="inline-flex items-center gap-2"
      role="group"
      aria-label={t('language')}
      data-test-id="dashboard-locale-switcher"
    >
      {LANGUAGE_META.map((lang) => {
        const active = lang.code === current
        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => select(lang.code)}
            disabled={active || pending}
            aria-pressed={active}
            aria-label={lang.nativeName}
            data-active={active ? 'true' : 'false'}
            data-test-id={`dashboard-locale-${lang.code}`}
            className="font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-40)] transition-colors hover:text-[var(--ink)] disabled:cursor-default data-[active=true]:text-[var(--ink)]"
          >
            {lang.code}
          </button>
        )
      })}
    </div>
  )
}
