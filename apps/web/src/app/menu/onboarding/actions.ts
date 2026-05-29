'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getEffectiveOrganizationId, getSession } from '@iedora/product-menu/features/auth'
import {
  createTenant,
  setActiveTenant,
  TENANT_ROLE_PRESETS,
} from '@iedora/auth'
import { createSubscription } from '@iedora/billing'
import {
  PRODUCTS,
  PRODUCT_ONBOARDING_STATUSES,
  PRODUCT_ONBOARDING_STEPS,
} from '@iedora/brand'
import { projectProductState } from '@iedora/core-tenancy'
import { nextAvailableSlug, slugify } from '@iedora/product-menu/features/restaurant-slug'
import { signInUrl } from '@iedora/product-core/url'
import { publicUrl } from '@iedora/product-menu/shared/url'
import { db } from '@iedora/product-menu/shared/db/client'
import { menu, restaurant } from '@iedora/product-menu/shared/db/schema'
import { canAddRestaurant } from '@iedora/product-menu/features/plans'
import { enforceRateLimit } from '@iedora/product-menu/features/rate-limit'
import { ONBOARDING_STEPS } from '@iedora/product-menu/features/menu-onboarding'

const onboardingSchema = z.object({
  restaurantName: z.string().trim().min(2).max(80),
})

export type OnboardingFormState =
  | { error?: string; fieldErrors?: Partial<Record<keyof z.infer<typeof onboardingSchema>, string>> }
  | undefined

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertRestaurantWithDefaultMenu(
  tx: Tx,
  tenantId: string,
  restaurantName: string,
  slug: string,
): Promise<void> {
  const [created] = await tx
    .insert(restaurant)
    .values({ tenantId, name: restaurantName, slug })
    .returning({ id: restaurant.id })
  if (!created) throw new Error('onboarding: restaurant insert returned no rows')

  await tx.insert(menu).values({
    restaurantId: created.id,
    name: 'Main menu',
    position: 0,
  })
}

export async function completeOnboarding(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const parsed = onboardingSchema.safeParse({
    restaurantName: formData.get('restaurantName'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  const { restaurantName } = parsed.data

  const session = await getSession()
  if (!session?.user) redirect(signInUrl(publicUrl(ONBOARDING_STEPS.name.path).toString()))

  const decision = await enforceRateLimit('onboarding', `user:${session.user.id}`)
  if (!decision.ok) {
    return { error: `Too many attempts. Try again in ${decision.retryAfterSec}s.` }
  }

  // Allocate the public slug HERE so the same value is consistent across
  // the menu DB insert AND the better-auth org create call below.
  const slug = await nextAvailableSlug(slugify(restaurantName))

  // Existing org on session? Add restaurant under it (gated by plan).
  // First-time user? Create org via better-auth + first restaurant.
  const existingOrgId = await getEffectiveOrganizationId()

  if (existingOrgId) {
    const gate = await canAddRestaurant(existingOrgId)
    if (!gate.ok) {
      return {
        error: `Your plan allows ${gate.limit} restaurant${gate.limit === 1 ? '' : 's'}. Upgrade to Casa to add more.`,
      }
    }
    return addRestaurantToOrg(existingOrgId, restaurantName, slug)
  }

  return createOrgAndFirstRestaurant(restaurantName, slug)
}

async function addRestaurantToOrg(
  tenantId: string,
  restaurantName: string,
  slug: string,
): Promise<OnboardingFormState> {
  const session = await getSession()
  if (!session?.user) redirect(signInUrl(publicUrl(ONBOARDING_STEPS.name.path).toString()))
  try {
    await db.transaction((tx) =>
      insertRestaurantWithDefaultMenu(tx, tenantId, restaurantName, slug),
    )
  } catch (err) {
    console.error('[onboarding] restaurant creation under existing org failed', err)
    return { error: 'Could not create restaurant. Please try again.' }
  }

  // Cross-product projection: this tenant has a wizard in progress
  // again (new restaurant pending step 2). Best-effort — failure
  // doesn't block the redirect; the user can still complete the
  // wizard, and the projection is rewritten on success.
  await projectProductState({
    tenantId,
    product: PRODUCTS.menu,
    status: PRODUCT_ONBOARDING_STATUSES.inProgress,
    currentStep: PRODUCT_ONBOARDING_STEPS[PRODUCTS.menu].menu,
    payload: { restaurantSlug: slug },
    actor: { userId: session.user.id, email: session.user.email, role: null },
  }).catch((err) => {
    console.error('[onboarding] projectProductState (add-another) failed', err)
  })

  revalidatePath('/menu/dashboard')
  redirect(ONBOARDING_STEPS.menu.buildPath({ slug }))
}

async function createOrgAndFirstRestaurant(
  restaurantName: string,
  slug: string,
): Promise<OnboardingFormState> {
  const session = await getSession()
  if (!session?.user) redirect(signInUrl(publicUrl(ONBOARDING_STEPS.name.path).toString()))

  let tenantId: string
  try {
    // Create the tenant + add the founder as owner (all tenant scopes).
    // Single transaction inside `createTenant`.
    const tenant = await createTenant({
      name: restaurantName,
      founder: {
        userId: session.user.id,
        scopes: TENANT_ROLE_PRESETS.owner,
      },
      actor: {
        userId: session.user.id,
        email: session.user.email,
        role: null,
      },
    })
    tenantId = tenant.id
  } catch (err) {
    console.error('[onboarding] tenant creation failed', err)
    return { error: 'Could not create tenant. Please try again.' }
  }

  // Enrol the tenant in the menu product on the free plan. This is the
  // cross-product signal "this tenant uses menu" — the menu landing
  // picker + dashboard layout read from `tenant_subscription` to know.
  try {
    await createSubscription({
      tenantId,
      product: PRODUCTS.menu,
      plan: 'free',
      status: 'active',
      actor: { userId: session.user.id, email: session.user.email },
    })
  } catch (err) {
    console.error('[onboarding] subscription creation failed', err)
    // Non-fatal — the tenant exists, plan lookups will fall back to
    // 'free' via the registry's default. Surface as a soft warning.
  }

  // Pin the session to the new tenant so subsequent page loads find
  // the right tenant context. `setActiveTenant` verifies membership
  // (the founder we just added).
  await setActiveTenant({
    sessionId: session.session.id,
    userId: session.user.id,
    tenantId,
    actor: {
      userId: session.user.id,
      email: session.user.email,
      role: null,
    },
  }).catch((err) => {
    console.error('[onboarding] setActiveTenant failed', err)
  })

  // Restaurant + default menu must commit together.
  try {
    await db.transaction((tx) =>
      insertRestaurantWithDefaultMenu(tx, tenantId, restaurantName, slug),
    )
  } catch (err) {
    console.error('[onboarding] restaurant creation failed', err)
    return { error: 'Could not create restaurant. Please try again.' }
  }

  // Project the menu's onboarding state into core so the admin can see
  // "this tenant is partway through menu's wizard". The product owns
  // its real state (`restaurant.onboarding_completed_at`); this is the
  // snapshot core reads.
  await projectProductState({
    tenantId,
    product: PRODUCTS.menu,
    status: PRODUCT_ONBOARDING_STATUSES.inProgress,
    currentStep: PRODUCT_ONBOARDING_STEPS[PRODUCTS.menu].menu,
    payload: { restaurantSlug: slug },
    actor: { userId: session.user.id, email: session.user.email, role: null },
  }).catch((err) => {
    console.error('[onboarding] projectProductState (first) failed', err)
  })

  revalidatePath('/menu/dashboard')
  redirect(ONBOARDING_STEPS.menu.buildPath({ slug }))
}
