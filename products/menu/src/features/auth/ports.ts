import type { Session } from './adapters/session'

export type { Session } from './adapters/session'

/**
 * AuthGateway — the slice's only direct dependency on the encrypted
 * session cookie + the local DB.
 *
 * Org-membership checks live behind `@/features/identity` (the Zitadel
 * port). This port stays narrow: session lookup + restaurant-row lookup
 * scoped to a tenant id whose membership the caller has already
 * verified via the identity slice.
 */
export interface AuthGateway {
  /**
   * Returns the current menu session by decrypting the request cookie,
   * or null if none / expired / tampered.
   */
  getSession(): Promise<Session | null>

  /**
   * Looks up a restaurant by id and confirms it belongs to `organizationId`.
   * Caller MUST have already verified that the user belongs to
   * `organizationId` (via `@/features/identity`).
   */
  findRestaurantByIdInOrg(params: {
    restaurantId: string
    organizationId: string
  }): Promise<{ id: string } | null>

  /**
   * Same as `findRestaurantByIdInOrg` but resolved by URL slug. Returns the
   * subset of columns guards expose to callers (`id`, `name`, `slug`).
   */
  findRestaurantBySlugInOrg(params: {
    slug: string
    organizationId: string
  }): Promise<{ id: string; name: string; slug: string } | null>
}
