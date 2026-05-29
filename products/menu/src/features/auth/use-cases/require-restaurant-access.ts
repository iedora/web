import 'server-only'
import { redirect } from 'next/navigation'
import { tenantContext, tracer, IEDORA_RESTAURANT_ID, IEDORA_TENANT_ID } from '@iedora/observability'
import type { AuthGateway } from '../ports'
import { requireActiveOrganization } from './require-active-organization'

/**
 * Tenant-scoped guard: verifies the caller has a session, belongs to an
 * org on Genkan, and that org owns the given restaurant. Redirects to
 * /dashboard when the restaurant doesn't belong to one of the caller's
 * orgs. Returns the session, tenantId, and restaurantId for
 * downstream queries.
 *
 * Seeds `tenantContext` with the resolved (restaurantId, tenantId)
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
      const { session, tenantId } = await requireActiveOrganization(auth)
      const row = await auth.findRestaurantByIdInOrg({
        restaurantId,
        tenantId,
      })
      if (!row) {
        span.setAttribute('iedora.auth.outcome', 'forbidden')
        redirect('/menu/dashboard')
      }
      // Seed the ALS store for the rest of the request's async chain.
      // Every downstream span (auto-instrumented or manual) picks up
      // tenant.restaurant_id / tenant.tenant_id from here on.
      tenantContext.enterWith({ restaurantId, tenantId })
      span.setAttribute(IEDORA_TENANT_ID, tenantId)
      span.setAttribute('iedora.auth.outcome', 'allowed')
      return { session, tenantId, restaurantId }
    } finally {
      span.end()
    }
  })
}
