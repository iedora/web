'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { LANGUAGE_CODES, type LanguageCode } from '@/features/i18n'
import { DASHBOARD_LOCALE_COOKIE } from '@/i18n/request'

// Setting the locale cookie persists the user's UI language across reloads
// and tabs. We don't tie it to the user table because (a) it's a personal
// preference, not a tenant setting, and (b) it works for unauthenticated
// auth pages too. Cookie is HttpOnly:false so e2e can read/inspect it.
export async function setUserLocale(locale: string) {
  if (!(LANGUAGE_CODES as readonly string[]).includes(locale)) {
    return { ok: false as const, error: 'Unsupported locale' }
  }
  const validated = locale as LanguageCode
  const store = await cookies()
  store.set(DASHBOARD_LOCALE_COOKIE, validated, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  revalidatePath('/', 'layout')
  return { ok: true as const, locale: validated }
}
