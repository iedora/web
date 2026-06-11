'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import {
  ACCESS_COOKIE,
  ApiError,
  REFRESH_COOKIE,
  authCookies,
  createTenant,
  refreshTokens,
} from '@iedora/api-client'
import { getSession } from '@iedora/product-menu/features/auth'
import {
  ONBOARDING_STEPS,
  createOnboardingRestaurant,
} from '@iedora/product-menu/features/menu-onboarding'
import { signInUrl } from '@iedora/product-menu/shared/auth-urls'
import { publicUrl } from '@iedora/product-menu/shared/url'

/**
 * Step-1 server action against the Go services:
 *
 *   1. No tenant on the session yet (first sign-in)? Provision one via
 *      the auth service (`POST /auth/tenants`) with the access token
 *      from the cookie jar.
 *   2. Refresh the token pair so the new access token carries the
 *      tenant id, and persist BOTH cookies (legal here — server
 *      action). `serverFetch` reads `cookies()` per call, so the
 *      restaurant call below already sees the refreshed token.
 *   3. Create the restaurant via the Go menu service — it owns slug
 *      derivation and the plan gate (422 over-limit → `{ error }`).
 *   4. Redirect into step 2 of the wizard with the slug Go returned.
 *
 * Users who already have a tenant (e.g. "add another restaurant")
 * skip 1–2 and go straight to the plan-gated create.
 */

const onboardingSchema = z.object({
  restaurantName: z.string().trim().min(2).max(80),
  // Optional address-or-tagline. Persists into the restaurant's public
  // description — the small italic line printed under the name.
  tagline: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
})

export type OnboardingFormState =
  | { error?: string; fieldErrors?: Partial<Record<keyof z.infer<typeof onboardingSchema>, string>> }
  | undefined

export async function completeOnboarding(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const parsed = onboardingSchema.safeParse({
    restaurantName: formData.get('restaurantName'),
    tagline: formData.get('tagline'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  const { restaurantName, tagline } = parsed.data
  const signInTarget = signInUrl(
    publicUrl(ONBOARDING_STEPS.name.path).toString(),
  )

  const session = await getSession()
  if (!session) redirect(signInTarget)

  if (!session.tenantId) {
    const store = await cookies()

    // 1. Provision the tenant, named after the first restaurant.
    const accessToken = store.get(ACCESS_COOKIE)?.value
    if (!accessToken) redirect(signInTarget)
    try {
      await createTenant(accessToken, restaurantName)
    } catch (err) {
      console.error('[onboarding] tenant creation failed', err)
      return { error: 'Could not create tenant. Please try again.' }
    }

    // 2. Rotate the token pair so the access token picks up the new
    //    tenant id, then persist both cookies. Subsequent `cookies()`
    //    reads in this same action observe the new values.
    const refreshToken = store.get(REFRESH_COOKIE)?.value
    const refreshed = refreshToken ? await refreshTokens(refreshToken) : null
    if (!refreshed) redirect(signInTarget)
    for (const c of authCookies(refreshed.tokens, refreshed.setCookies)) {
      store.set(c.name, c.value, c.options)
    }
  }

  // 3. Create the restaurant (+ optional tagline). Go owns the slug
  //    and the plan gate — a 422 over-limit surfaces as the form error.
  let slug: string
  try {
    const restaurant = await createOnboardingRestaurant({
      name: restaurantName,
      defaultLanguage: await getLocale(),
      tagline,
    })
    slug = restaurant.slug
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message }
    console.error('[onboarding] restaurant creation failed', err)
    return { error: 'Could not create restaurant. Please try again.' }
  }

  // 4. Into step 2 of the wizard.
  redirect(ONBOARDING_STEPS.menu.buildPath({ slug }))
}
