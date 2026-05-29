/**
 * Core audit event taxonomy — every state-changing primitive in
 * `@iedora/core-auth` writes one of these into `core.audit_log`. Constants
 * (not raw strings) so adding/renaming an event is a single-file
 * change that the type system propagates to every emitter + every
 * query that filters on `event`.
 *
 * Shape mirrors `BILLING_AUDIT_EVENTS` in `@iedora/core-billing` — same
 * `<resource>.<verb-past-tense>` convention. Events from this set and
 * the billing set never collide (different prefixes).
 *
 * Framework-free — imported from primitives, tests, and the admin
 * timeline filter UI.
 */
export const CORE_AUDIT_EVENTS = {
  // ── Tenancy ──────────────────────────────────────────────────────
  TENANT_CREATED: 'tenant.created',

  // ── Membership ───────────────────────────────────────────────────
  TENANT_MEMBER_ADDED: 'tenant.member.added',
  TENANT_MEMBER_SCOPES_UPDATED: 'tenant.member.scopes-updated',
  TENANT_MEMBER_REMOVED: 'tenant.member.removed',

  // ── Session ──────────────────────────────────────────────────────
  TENANT_ACTIVE_SWITCHED: 'tenant.active.switched',

  // ── Staff scope grants (highest blast radius) ────────────────────
  USER_SCOPES_UPDATED: 'user.scopes.updated',

  // ── Ban lifecycle (replaces better-auth admin plugin's events) ──
  USER_BANNED: 'user.banned',
  USER_UNBANNED: 'user.unbanned',

  // ── Impersonation ────────────────────────────────────────────────
  USER_IMPERSONATED: 'user.impersonated',
  USER_IMPERSONATION_STOPPED: 'user.impersonation.stopped',

  // ── Cross-product projection (`@iedora/core-tenancy`) ────────────────
  TENANT_PRODUCT_STATE_PROJECTED: 'tenant.product.state-projected',
} as const
export type CoreAuditEvent =
  (typeof CORE_AUDIT_EVENTS)[keyof typeof CORE_AUDIT_EVENTS]

/**
 * Slim caller-identity snapshot — passed into every state-changing
 * primitive so the audit row can attribute the change. Distinct from
 * the full better-auth session: primitives are framework-free and
 * must not import `next/headers` / `server-only`.
 *
 * `userId` is required (the system-driven `null` actor is the
 * exception, used by signup hooks — they call `recordAudit` directly,
 * not via these primitives).
 */
export type AuditActor = {
  userId: string
  email?: string | null
  role?: string | null
}
