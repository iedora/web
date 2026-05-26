import 'server-only'
import { redirect } from 'next/navigation'
import { tenantContext, tracer, IEDORA_RESTAURANT_ID, IEDORA_ORGANIZATION_ID } from '@iedora/observability'
import type { AuthGateway } from '../ports'
import { requireActiveOrganization } from './require-active-organization'

/**
 * Tenant-scoped guard: verifies the caller has a session, belongs to an
 * org on Genkan, and that org owns the given restaurant. Redirects to
 * /dashboard when the restaurant doesn't belong to one of the caller's
 * orgs. Returns the session, organizationId, and restaurantId for
 * downstream queries.
 *
 * Seeds `tenantContext` with the resolved (restaurantId, organizationId)
 * via `enterWith`. The store persists through the remainder of the
 * request's async chain — every span started downstream (Drizzle
 * adapters, S3 calls, fetch instrumentations) gets stamped with the
 * tenant attributes by TenantContextSpanProcessor automatically.
 *
 * Pattern modeled on Trigger.dev's `attributesFromAuthenticatedEnv`
 * (apps/webapp/app/v3/tracer.server.ts) — set once at the boundary,
 * propagate through context.
 */
export async function requireRestaurantAccess(
  auth: AuthGateway,
  restaurantId: string,
) {
  return tracer.startActiveSpan('auth.require-restaurant-access', async (span) => {
    span.setAttribute(IEDORA_RESTAURANT_ID, restaurantId)
    try {
      const { session, organizationId } = await requireActiveOrganization(auth)
      const row = await auth.findRestaurantByIdInOrg({
        restaurantId,
        organizationId,
      })
      if (!row) {
        span.setAttribute('iedora.auth.outcome', 'forbidden')
        redirect('/dashboard')
      }
      // Seed the ALS store for the rest of the request's async chain.
      // Every downstream span (auto-instrumented or manual) picks up
      // tenant.restaurant_id / tenant.organization_id from here on.
      tenantContext.enterWith({ restaurantId, organizationId })
      span.setAttribute(IEDORA_ORGANIZATION_ID, organizationId)
      span.setAttribute('iedora.auth.outcome', 'allowed')
      return { session, organizationId, restaurantId }
    } finally {
      span.end()
    }
  })
}
