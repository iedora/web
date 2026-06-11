'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  REFRESH_COOKIE,
  authCookies,
  clearedAuthCookies,
  login,
  logout,
  register,
  type AuthResult,
} from '@iedora/api-client'
import { brandUrl, isSameIedoraOrigin } from '@iedora/brand'

/**
 * Auth server actions — the only code that exchanges credentials with
 * the Go auth service and writes the auth cookies. Forms submit here
 * via useActionState; on success the action redirects to the validated
 * `next` target, on failure it returns a state the form translates.
 */

export type AuthFormState = {
  error: 'invalid' | 'generic' | null
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  let result: AuthResult
  try {
    result = await login(email, password)
  } catch {
    return { error: 'invalid' }
  }
  await persistAuth(result)
  redirect(safeNext(formData))
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get('name') ?? '')
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  let result: AuthResult
  try {
    result = await register(email, password, name)
  } catch {
    return { error: 'generic' }
  }
  await persistAuth(result)
  redirect(safeNext(formData))
}

/** Revokes the session on the Go side and clears both auth cookies. */
export async function signOutAction(next?: string): Promise<void> {
  const store = await cookies()
  const refreshToken = store.get(REFRESH_COOKIE)?.value
  if (refreshToken) {
    await logout(refreshToken)
  }
  for (const c of clearedAuthCookies()) {
    store.set(c.name, c.value, c.options)
  }
  redirect(isSameIedoraOrigin(next) ? next! : brandUrl())
}

async function persistAuth(result: AuthResult): Promise<void> {
  const store = await cookies()
  for (const c of authCookies(result.tokens, result.setCookies)) {
    store.set(c.name, c.value, c.options)
  }
}

function safeNext(formData: FormData): string {
  const next = formData.get('next')
  return typeof next === 'string' && isSameIedoraOrigin(next) ? next : brandUrl()
}
