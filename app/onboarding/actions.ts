'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { menu, restaurant } from '@/lib/db/schema'

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

  // 1. Create the organization (user becomes owner)
  const orgResult = await auth.api.createOrganization({
    headers: reqHeaders,
    body: {
      name: restaurantName,
      slug,
    },
  })

  if (!orgResult) {
    return { error: 'Could not create organization. Slug may already be taken.' }
  }

  // 2. Activate it on the session — Better Auth does NOT do this automatically
  await auth.api.setActiveOrganization({
    headers: reqHeaders,
    body: { organizationId: orgResult.id },
  })

  // 3. Create the first restaurant inside that organization, plus a default
  // menu so the builder has something to open into immediately.
  const [createdRestaurant] = await db
    .insert(restaurant)
    .values({
      organizationId: orgResult.id,
      name: restaurantName,
      slug,
    })
    .returning({ id: restaurant.id })

  await db.insert(menu).values({
    restaurantId: createdRestaurant.id,
    name: 'Main menu',
    position: 0,
  })

  revalidatePath('/dashboard')
  redirect('/dashboard')
}
