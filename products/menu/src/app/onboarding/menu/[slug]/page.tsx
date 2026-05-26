import { requireRestaurantBySlug } from '@/features/auth'
import { MenuOnboardingPage } from '@/features/menu-onboarding'
import { canGenerateAiMenu } from '@/features/plans'

/**
 * Step 2 of onboarding — AI menu setup. Auth-gates by slug (the
 * caller arrived here from `completeOnboarding` so they own this
 * restaurant; the guard re-verifies on every request anyway so a
 * stale URL drops to `/dashboard`).
 *
 * The slice's `<MenuOnboardingPage>` owns the layout, eyebrow, and
 * the wizard + skip composition. This file is a thin server entry +
 * a quota pre-fetch so the operator sees their weekly allowance
 * before they pick a photo.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { restaurant, organizationId } = await requireRestaurantBySlug(slug)
  const gate = await canGenerateAiMenu(organizationId)

  return (
    <MenuOnboardingPage
      slug={restaurant.slug}
      restaurantId={restaurant.id}
      initialQuota={{ used: gate.used, limit: gate.limit }}
    />
  )
}
