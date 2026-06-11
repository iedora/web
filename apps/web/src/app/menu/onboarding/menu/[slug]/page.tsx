import { requireRestaurantBySlug } from '@iedora/product-menu/features/auth'
import { MenuOnboardingPage } from '@iedora/product-menu/features/menu-onboarding'
import { markMenuOnboardingComplete } from './actions'
import '../../onboarding.css'

/**
 * Step 2 of onboarding — first menu setup. Auth-gates by slug (the
 * caller arrived here from `completeOnboarding` so they own this
 * restaurant; the guard re-verifies against the Go service on every
 * request anyway so a stale URL drops to `notFound`).
 *
 * The slice's `<MenuOnboardingPage>` owns the layout, eyebrow, and
 * the seed-or-skip composition.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { restaurant } = await requireRestaurantBySlug(slug)

  // Bind the slug into a server-action closure the page can call
  // from a client-side completion handler. Keeps the slice free of
  // any direct API import on the client.
  async function onComplete() {
    'use server'
    await markMenuOnboardingComplete({ slug: restaurant.slug })
  }

  return (
    <MenuOnboardingPage slug={restaurant.slug} onComplete={onComplete} />
  )
}
