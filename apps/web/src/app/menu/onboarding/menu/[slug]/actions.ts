'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSession, requireRestaurantBySlug } from '@iedora/product-menu/features/auth'
import {
  markRestaurantOnboardingComplete,
  ONBOARDING_STEPS,
} from '@iedora/product-menu/features/menu-onboarding'
import { signInUrl } from '@iedora/product-core/url'
import { publicUrl } from '@iedora/product-menu/shared/url'
import { PRODUCTS, PRODUCT_ONBOARDING_STATUSES } from '@iedora/brand'
import { projectProductState } from '@iedora/core-tenancy'

/**
 * Mark the restaurant's onboarding wizard as completed (whether the
 * operator hit Skip or the AI-import finished). Without this row
 * write, navigating back from this step lands on `/menu/onboarding`
 * with the resume gate firing and pushing the user right back into
 * step 2 forever.
 *
 * Idempotent: re-runs on an already-completed row simply overwrite
 * the timestamp. The guard re-asserts tenancy
 * (`requireRestaurantBySlug`) so a forged slug from another tenant
 * can't flip the flag.
 */
export async function markMenuOnboardingComplete(input: {
  slug: string
}): Promise<void> {
  let tenantId: string
  let userId: string
  let userEmail: string
  try {
    const ctx = await requireRestaurantBySlug(input.slug)
    tenantId = ctx.tenantId
    const session = await getSession()
    if (!session?.user) throw new Error('no session')
    userId = session.user.id
    userEmail = session.user.email
  } catch {
    redirect(signInUrl(publicUrl('/menu/dashboard').toString()))
  }
  await markRestaurantOnboardingComplete(input.slug)
  // Project terminal state so core admin sees "menu completed" without
  // querying restaurant rows. Idempotent — re-runs (e.g. user hits
  // Skip then later imports anyway) just re-stamp completedAt.
  await projectProductState({
    tenantId,
    product: PRODUCTS.menu,
    status: PRODUCT_ONBOARDING_STATUSES.completed,
    currentStep: null,
    payload: { restaurantSlug: input.slug },
    actor: { userId, email: userEmail, role: null },
  }).catch((err) => {
    console.error('[onboarding] projectProductState (complete) failed', err)
  })
  revalidatePath(ONBOARDING_STEPS.name.path)
  revalidatePath('/menu/dashboard')
}
