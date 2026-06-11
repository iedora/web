import 'server-only'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { ApiError, getSession as readSession, type Session } from '@iedora/api-client'
import { signInUrl } from '../../shared/auth-urls'
import { publicUrl } from '../../shared/url'
import { getRestaurant, type MenuSummary, type Restaurant } from '../../shared/api'

/**
 * Auth slice — thin guards over the access-token session.
 *
 * Authorization proper lives in the Go menu service: every API call is
 * verified there (tenant scoping, restaurant ownership, staff role).
 * These guards only decide WHERE to send an unauthenticated /
 * tenant-less visitor; they never query data.
 */

/** Operator roles minted by the Go auth service (internal/authz). */
const STAFF_ROLES = ['iedora-admin', 'iedora-support'] as const

export type { Session }

/** True when the session holds a cross-tenant operator role. */
export function isStaff(session: Session | null): boolean {
  return !!session?.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r))
}

/**
 * Non-redirecting read of the session. Returns null when there's no
 * cookie / it's expired. Use for chrome that should render signed-in
 * vs signed-out without forcing a redirect.
 */
export const getSession = cache(() => readSession())

/**
 * Redirecting session guard: bounces anonymous visitors to sign-in
 * with a `next` back to the given internal path (default: dashboard).
 */
export const verifySession = cache(async (nextPath = '/menu/dashboard'): Promise<Session> => {
  const session = await getSession()
  if (!session) {
    redirect(signInUrl(publicUrl(nextPath).toString()))
  }
  return session
})

/**
 * Guarantees an authenticated session AND a tenant id. Tenant users
 * without one get bounced into /menu/onboarding (first sign-in before
 * they've created a tenant); staff get bounced to the dashboard — the
 * onboarding flow doesn't apply to them.
 */
export const requireActiveOrganization = cache(
  async (): Promise<{ session: Session; tenantId: string }> => {
    const session = await verifySession()
    if (!session.tenantId) {
      redirect(isStaff(session) ? '/menu/dashboard' : '/menu/onboarding')
    }
    return { session, tenantId: session.tenantId }
  },
)

/**
 * Session + ownership guard keyed by restaurant slug. The ownership
 * check is the Go service's: a foreign or unknown slug 404s there
 * (staff tokens read cross-tenant), which we surface as `notFound()`.
 * Returns the full restaurant + its menu summaries so pages don't
 * re-fetch for the header.
 */
export const requireRestaurantBySlug = cache(
  async (slug: string): Promise<{ restaurant: Restaurant; menus: MenuSummary[] }> => {
    await verifySession(`/menu/dashboard/r/${slug}`)
    try {
      return await getRestaurant(slug)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        notFound()
      }
      throw err
    }
  },
)

/**
 * Staff-only guard for the cross-tenant admin surfaces (directory,
 * QR codes). Hides the surface from non-staff via the dashboard.
 */
export const requireStaff = cache(async (): Promise<Session> => {
  const session = await verifySession()
  if (!isStaff(session)) {
    redirect('/menu/dashboard')
  }
  return session
})
