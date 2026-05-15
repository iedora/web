import type { Session } from './adapters/better-auth-instance'

/**
 * AuthGateway — the slice's only dependency on the outside world.
 *
 * Use-cases call methods on this interface; production wires it to
 * `betterAuthGateway` (Better Auth + Drizzle). Tests wire fakes.
 *
 * Keep this surface minimal: just the lookups the guards actually need.
 */
export interface AuthGateway {
  /**
   * Returns the current Better Auth session, or null if the caller is
   * unauthenticated. Backed by `auth.api.getSession({ headers })` in prod.
   */
  getSession(): Promise<Session | null>

  /**
   * The user's earliest organization membership, used as a fallback when
   * Better Auth hasn't restored `activeOrganizationId` after re-login.
   * Returns null only when the user truly belongs to no organization.
   */
  findEarliestOrgMembership(userId: string): Promise<{ organizationId: string } | null>

  /**
   * Looks up a restaurant by id AND verifies the caller is a member of its
   * owning organization, scoped to a specific organizationId for tenant
   * isolation. Returns the row only if the join succeeds.
   */
  findRestaurantByIdInOrg(params: {
    restaurantId: string
    organizationId: string
    userId: string
  }): Promise<{ id: string } | null>

  /**
   * Same as `findRestaurantByIdInOrg` but resolved by URL slug. Returns the
   * subset of columns guards expose to callers (`id`, `name`, `slug`).
   */
  findRestaurantBySlugInOrg(params: {
    slug: string
    organizationId: string
    userId: string
  }): Promise<{ id: string; name: string; slug: string } | null>
}
