import 'server-only'
import { redirect } from 'next/navigation'
import { tenantContext, tracer, IEDORA_RESTAURANT_ID, IEDORA_ORGANIZATION_ID } from '@iedora/observability'
import type { AuthGateway } from '../ports'
import { requireActiveOrganization } from './require-active-organization'

/**
 * Same as `requireRestaurantAccess` but resolved by URL slug. Returns the
 * matched restaurant subset (`id`, `name`, `slug`) so callers don't need a
 * follow-up query just to render the page header.
 *
 * Same tenant-context seeding as `requireRestaurantAccess`: downstream
 * spans pick up tenant attribution automatically via
 * TenantContextSpanProcessor.
 */
export async function requireRestaurantBySlug(
  auth: AuthGateway,
  slug: string,
) {
  return tracer.startActiveSpan(
    'auth.require-restaurant-by-slug',
    async (span) => {
      span.setAttribute('iedora.restaurant_slug', slug)
      try {
        const { session, organizationId } = await requireActiveOrganization(auth)
        const row = await auth.findRestaurantBySlugInOrg({
          slug,
          organizationId,
        })
        if (!row) {
          span.setAttribute('iedora.auth.outcome', 'forbidden')
          redirect('/dashboard')
        }
        tenantContext.enterWith({
          restaurantId: row.id,
          organizationId,
        })
        span.setAttribute(IEDORA_ORGANIZATION_ID, organizationId)
        span.setAttribute(IEDORA_RESTAURANT_ID, row.id)
        span.setAttribute('iedora.auth.outcome', 'allowed')
        return { session, organizationId, restaurant: row }
      } finally {
        span.end()
      }
    },
  )
}
