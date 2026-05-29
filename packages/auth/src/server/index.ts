import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { auth, type AuthSession } from '../auth'
import { recordAudit } from '../audit'
import { getActiveTenantId } from '../sessions'
import { getMemberScopes } from '../tenant-members'
import { userHasScope } from '../staff'
import type { Scope } from '../scopes'

/**
 * Next-aware authorisation surface — the bridge between the framework-
 * free primitives in `@iedora/auth` and Next routes / server actions.
 *
 * Two layers of scope evaluation, in this order:
 *
 *   1. Staff (cross-tenant) — `user.scopes` includes the requested
 *      scope ⇒ allow. Staff wildcards transcend every tenant.
 *   2. Tenant (per-tenant) — `tenant_member.scopes` for the (active
 *      tenant, user) pair includes the requested scope ⇒ allow.
 *
 * `requireScope` redirects on miss with an `auth.denied` audit row.
 * `hasScope` returns false silently — use for conditional UI.
 *
 * Active tenant is read from the session via `getActiveTenantId`,
 * which lazily revalidates membership. A stale active id (member
 * removed) returns `null` and the tenant layer denies — the staff
 * layer can still authorise via wildcard.
 */

/**
 * Cached read of the current better-auth session. `cache()` dedupes
 * within a single render so multiple guards in the same RSC tree
 * only hit the wire once.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  return auth.api.getSession({ headers: await headers() })
})

/**
 * Asserts there's a session; redirects to sign-in if not. Returns
 * the non-null session.
 *
 * Sign-in URL building lives in product packages (`@iedora/product-
 * core/url`) — this helper is intentionally low-level so it doesn't
 * pull in a product-specific URL helper. Callers redirect themselves.
 *
 * Most callers want `getSession()` plus a redirect of their own choice
 * — only use `requireSession()` when "there is no caller-specific
 * sign-in URL" is genuinely the right behaviour (rare).
 */
export async function requireSession(): Promise<NonNullable<AuthSession>> {
  const s = await getSession()
  if (!s?.user) throw new Error('[iedora/auth] requireSession: no session')
  return s
}

// ─── Scope evaluation ──────────────────────────────────────────────

/**
 * True iff the current caller may exercise the scope. Checks staff
 * first (wildcards short-circuit cross-tenant), then tenant. Returns
 * false for anonymous callers without throwing.
 */
export async function hasScope(scope: Scope): Promise<boolean> {
  const s = await getSession()
  if (!s?.user) return false
  // Staff wildcard short-circuit.
  if (await userHasScope(s.user.id, scope)) return true
  // Tenant fallback — only `tenant:*` scopes resolve here.
  const tenantId = await getActiveTenantId({
    sessionId: s.session.id,
    userId: s.user.id,
  })
  if (!tenantId) return false
  const scopes = await getMemberScopes({ tenantId, userId: s.user.id })
  return scopes?.includes(scope) ?? false
}

/**
 * Same as `hasScope` but throws on miss + audits the denied attempt.
 * Throws instead of redirecting so the caller decides where to send
 * the user (redirect to sign-in vs notFound vs forbidden page).
 *
 * The thrown error is non-`Error` — callers shouldn't catch and
 * recover; this is "you don't get to do this".
 */
export async function requireScope(scope: Scope): Promise<void> {
  const ok = await hasScope(scope)
  if (ok) return
  const s = await getSession()
  await recordAudit({
    event: 'auth.denied',
    outcome: 'denied',
    actor: s?.user
      ? {
          userId: s.user.id,
          email: s.user.email,
          role: null,
        }
      : null,
    headers: await headers(),
    meta: { scope, reason: s ? 'no-scope' : 'no-session' },
    important: false,
  })
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw new ScopeDeniedError(scope)
}

/** Marker error for callers that want to differentiate "scope denied" from other failures. */
export class ScopeDeniedError extends Error {
  readonly scope: Scope
  constructor(scope: Scope) {
    super(`[iedora/auth] scope denied: ${scope}`)
    this.name = 'ScopeDeniedError'
    this.scope = scope
  }
}

/**
 * Scope check against a specific tenant (not necessarily the active
 * one). Used by admin actions that act on tenants the caller isn't
 * currently scoped into.
 */
export async function hasScopeInTenant(
  tenantId: string,
  scope: Scope,
): Promise<boolean> {
  const s = await getSession()
  if (!s?.user) return false
  if (await userHasScope(s.user.id, scope)) return true
  const scopes = await getMemberScopes({ tenantId, userId: s.user.id })
  return scopes?.includes(scope) ?? false
}

// ─── Helpful re-exports ────────────────────────────────────────────

export { getActiveTenantId, setActiveTenant } from '../sessions'
export {
  getUserScopes,
  setUserScopes,
  userHasScope,
  isStaffUser,
  banUser,
  unbanUser,
  isBanned,
  impersonateUser,
  stopImpersonating,
  listUsers,
  getUser,
  type UserRow,
  type ListUsersFilter,
  type ListUsersResult,
} from '../staff'
