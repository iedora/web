'use server'

import { revalidatePath } from 'next/cache'
import {
  markRestaurantOnboardingComplete,
  ONBOARDING_STEPS,
} from '@iedora/product-menu/features/menu-onboarding'

/**
 * Mark the restaurant's onboarding wizard as completed (whether the
 * operator hit Skip or the AI-import finished). Without this flag the
 * `/menu/onboarding` resume gate keeps bouncing the user back into
 * step 2 forever.
 *
 * Idempotent: re-runs on an already-completed restaurant simply
 * re-stamp the timestamp. Tenancy is enforced by the Go service via
 * the caller's Bearer token — a forged slug from another tenant 404s
 * there, and the wizard's best-effort completion handler logs it.
 */
export async function markMenuOnboardingComplete(input: {
  slug: string
}): Promise<void> {
  await markRestaurantOnboardingComplete(input.slug)
  revalidatePath(ONBOARDING_STEPS.name.path)
  revalidatePath('/menu/dashboard')
}
