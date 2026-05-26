'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getEffectiveOrganizationId, getSession } from '@/features/auth'
import { auth } from '@iedora/auth'
import { nextAvailableSlug, slugify } from '@/features/restaurant-slug'
import { signInUrl } from '@iedora/brand'
import { publicUrl } from '@/shared/url'
import { db } from '@/shared/db/client'
import { menu, restaurant } from '@/shared/db/schema'
import { canAddRestaurant } from '@/features/plans'
import { enforceRateLimit } from '@/features/rate-limit'

const onboardingSchema = z.object({
  restaurantName: z.string().trim().min(2).max(80),
})

export type OnboardingFormState =
  | { error?: string; fieldErrors?: Partial<Record<keyof z.infer<typeof onboardingSchema>, string>> }
  | undefined

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertRestaurantWithDefaultMenu(
  tx: Tx,
  organizationId: string,
  restaurantName: string,
  slug: string,
): Promise<void> {
  const [created] = await tx
    .insert(restaurant)
    .values({ organizationId, name: restaurantName, slug })
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
  if (!session?.user) redirect(signInUrl(publicUrl('/onboarding').toString()))

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
  organizationId: string,
  restaurantName: string,
  slug: string,
): Promise<OnboardingFormState> {
  try {
    await db.transaction((tx) =>
      insertRestaurantWithDefaultMenu(tx, organizationId, restaurantName, slug),
    )
  } catch (err) {
    console.error('[onboarding] restaurant creation under existing org failed', err)
    return { error: 'Could not create restaurant. Please try again.' }
  }

  revalidatePath('/dashboard')
  redirect(`/onboarding/menu/${slug}`)
}

async function createOrgAndFirstRestaurant(
  restaurantName: string,
  slug: string,
): Promise<OnboardingFormState> {
  // Create the org via better-auth — it owns the org row in the `core`
  // schema, mints an owner-role membership for the caller, and returns
  // the id we stash on the restaurant row. The headers carry the
  // session cookie so the API knows who the owner is.
  let organizationId: string
  try {
    const org = await auth.api.createOrganization({
      body: {
        name: restaurantName,
        slug,
      },
      headers: await headers(),
    })
    if (!org?.id) {
      return { error: 'Could not create organization. Please try again.' }
    }
    organizationId = org.id
  } catch (err) {
    console.error('[onboarding] org creation failed', err)
    return { error: 'Could not create organization. Please try again.' }
  }

  // Make it the active org on the caller's session so subsequent
  // page loads find the right tenant context. Best-effort — a failure
  // here is recoverable on next sign-in (the user picks the org from
  // the switcher and we set it then).
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  }).catch(() => undefined)

  // Restaurant + default menu must commit together.
  try {
    await db.transaction((tx) =>
      insertRestaurantWithDefaultMenu(tx, organizationId, restaurantName, slug),
    )
  } catch (err) {
    console.error('[onboarding] restaurant creation failed', err)
    return { error: 'Could not create restaurant. Please try again.' }
  }

  revalidatePath('/dashboard')
  redirect(`/onboarding/menu/${slug}`)
}
