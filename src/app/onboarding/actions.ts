'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { getEffectiveOrganizationId } from '@/features/auth'
import { db } from '@/shared/db/client'
import { menu, organization, restaurant, session as sessionTable } from '@/shared/db/schema'
import { canAddRestaurant } from '@/features/plans'

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

const onboardingSchema = z.object({
  restaurantName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRegex, 'Use lowercase letters, numbers, and hyphens (2-40 chars)'),
})

export type OnboardingFormState =
  | { error?: string; fieldErrors?: Partial<Record<keyof z.infer<typeof onboardingSchema>, string>> }
  | undefined

/** The tx handle Drizzle yields to its callback. Inferred so we don't drag in
 *  the upstream generics every time we want a typed transactional helper. */
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
    slug: formData.get('slug'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  const { restaurantName, slug } = parsed.data
  const reqHeaders = await headers()

  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session?.user) redirect('/login')

  // Existing org? Add the restaurant under it (gated by plan limit). Brand-new
  // user? Create org + first restaurant. Plans are scoped to the org so the
  // `+ new restaurant` flow on the dashboard makes the gate meaningful — every
  // restaurant lives under a single tenant rather than spawning a fresh one.
  const existingOrgId = await getEffectiveOrganizationId(
    session.user.id,
    session.session.activeOrganizationId,
  )

  if (existingOrgId) {
    const gate = await canAddRestaurant(existingOrgId)
    if (!gate.ok) {
      return {
        error: `Your plan allows ${gate.limit} restaurant${gate.limit === 1 ? '' : 's'}. Upgrade to Casa to add more.`,
      }
    }
    return addRestaurantToOrg(existingOrgId, restaurantName, slug)
  }

  return createOrgAndFirstRestaurant(reqHeaders, restaurantName, slug)
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
    return { error: 'Could not create restaurant. The slug may already be taken.' }
  }

  revalidatePath('/dashboard')
  redirect('/dashboard')
}

async function createOrgAndFirstRestaurant(
  reqHeaders: Headers,
  restaurantName: string,
  slug: string,
): Promise<OnboardingFormState> {
  const orgResult = await auth.api.createOrganization({
    headers: reqHeaders,
    body: { name: restaurantName, slug },
  })

  if (!orgResult) {
    return { error: 'Could not create organization. Slug may already be taken.' }
  }

  await auth.api.setActiveOrganization({
    headers: reqHeaders,
    body: { organizationId: orgResult.id },
  })

  // Restaurant + default menu must commit together; if the transaction fails
  // (missing migration, FK, etc.) we tear down the Better Auth org we just
  // created so the user isn't stranded with an empty org that the dashboard
  // shows but the UI can't escape (the loop we hit on 2026-05-08).
  try {
    await db.transaction((tx) =>
      insertRestaurantWithDefaultMenu(tx, orgResult.id, restaurantName, slug),
    )
  } catch (err) {
    // CASCADE on member.organizationId drops the membership; session has no
    // FK on activeOrganizationId so we clear it explicitly for any session
    // that pointed at the org we're about to delete.
    await db
      .update(sessionTable)
      .set({ activeOrganizationId: null })
      .where(eq(sessionTable.activeOrganizationId, orgResult.id))
    await db.delete(organization).where(eq(organization.id, orgResult.id))
    console.error('[onboarding] restaurant creation failed, rolled back org', err)
    return { error: 'Could not create restaurant. Please try again.' }
  }

  revalidatePath('/dashboard')
  redirect('/dashboard')
}
