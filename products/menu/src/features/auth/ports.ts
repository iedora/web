/**
 * Auth slice ports — the narrow surface backed by better-auth + Drizzle.
 *
 * Identity (sessions, users, orgs, memberships) lives in the `@iedora/auth`
 * `core` schema; restaurant ownership lives in the menu DB. The gateway
 * unifies the two so use-cases speak in domain terms (Session + tenant
 * restaurants) instead of two separate libraries.
 */

/**
 * The session shape consumed by the rest of the menu app.
 *
 * Source: better-auth's `auth.api.getSession()` plus the organization
 * plugin's `activeOrganizationId`. Translated by `adapters/drizzle.ts`.
 *
 * `roles` is a back-compat shim — the previous Zitadel implementation
 * surfaced an array; better-auth gives us a scalar `role` (cross-tenant)
 * plus a per-org `member.role` looked up at permission-check time. We
 * expose both so existing consumers that read `.role` (singular) or
 * `.roles.includes('iedora-admin')` keep working.
 *
 * `permissions` is intentionally always `[]` — granular per-resource
 * checks go through `requireScope()` (which calls
 * `auth.api.hasPermission` under the hood), not through a flat list on
 * the session. New consumers should reach for `requireScope`.
 */
export type Session = {
  user: {
    id: string
    email: string
    name: string
    role: string | null
    roles: string[]
    permissions: string[]
  }
  session: {
    id: string
    activeOrganizationId: string | null
  }
  /** Back-compat alias for `session.id`. */
  sid: string
  /** Back-compat: Unix-seconds expiry mirrored from `session.expiresAt`. */
  expiresAt: number
}

/**
 * The gateway. One method per atomic read; no Drizzle / better-auth /
 * Next types leak past the interface so adapters can be swapped (e.g. a
 * PGLite fake in tests).
 */
export interface AuthGateway {
  /** Decoded session or null when not signed in / expired / tampered. */
  getSession(): Promise<Session | null>

  /** Look up a menu restaurant by id, scoped to a tenant org. */
  findRestaurantByIdInOrg(params: {
    restaurantId: string
    organizationId: string
  }): Promise<{ id: string } | null>

  /** Same, but resolved by URL slug. */
  findRestaurantBySlugInOrg(params: {
    slug: string
    organizationId: string
  }): Promise<{ id: string; name: string; slug: string } | null>
}
