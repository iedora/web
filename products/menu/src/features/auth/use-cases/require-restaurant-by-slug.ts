import 'server-only'
import { redirect } from 'next/navigation'
import { tenantContext, tracer, IEDORA_RESTAURANT_ID, IEDORA_TENANT_ID } from '@iedora/observability'
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
        const { session, tenantId } = await requireActiveOrganization(auth)
        const row = await auth.findRestaurantBySlugInOrg({
          slug,
          tenantId,
        })
        if (!row) {
          span.setAttribute('iedora.auth.outcome', 'forbidden')
          redirect('/menu/dashboard')
        }
        tenantContext.enterWith({
          restaurantId: row.id,
          tenantId,
        })
        span.setAttribute(IEDORA_TENANT_ID, tenantId)
        span.setAttribute(IEDORA_RESTAURANT_ID, row.id)
        span.setAttribute('iedora.auth.outcome', 'allowed')
        return { session, tenantId, restaurant: row }
      } finally {
        span.end()
      }
    },
  )
}
