import 'server-only'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { recordAudit } from '@iedora/core-auth'
import {
  getSession,
  userHasScope,
  hasScope as hasScopeServer,
} from '@iedora/core-auth/server'
import { signInUrl } from './url'
import { type Scope } from '@iedora/core-auth/scopes'

/**
 * Non-redirecting read of the current better-auth session. Returns
 * `null` when there's no cookie / expired / tampered.
 *
 * Thin pass-through over `@iedora/core-auth/server.getSession()`. Kept in
 * this package's public API for callers that already import from
 * `@iedora/product-core` and prefer not to add a second auth dep.
 */
export { getSession }

/**
 * Capture a denied authz attempt to the audit log. Important=false —
 * the timeline is dominated by successes; denials are filterable
 * separately (probes + accidental clicks generate lots of these).
 */
async function recordDenied(input: {
  reason: 'no-session' | 'no-scope'
  scope: string
  session?: Awaited<ReturnType<typeof getSession>>
  h: Headers
}): Promise<void> {
  await recordAudit({
    event: 'auth.denied',
    outcome: 'denied',
    actor: input.session?.user
      ? {
          userId: input.session.user.id,
          // `user.role` is gone; staff identity is now `user.scopes`.
          // The audit row keeps a single string for searchability —
          // pass null and rely on the actorUserId for cross-referencing.
          role: null,
          email: input.session.user.email,
        }
      : null,
    headers: input.h,
    meta: { reason: input.reason, scope: input.scope },
    important: false,
  })
}

/**
 * Non-throwing scope probe. Returns true iff the current caller has
 * the requested scope — STAFF wildcard first (`user.scopes`), then
 * the per-tenant fallback (`tenant_member.scopes` for the active
 * tenant). Use to conditionally render UI; never inverts (surfaces
 * hidden by absence, not by explicit deny).
 *
 * Delegates to `@iedora/core-auth/server.hasScope` — the same primitive
 * the rest of the estate uses.
 */
export async function hasScope(scope: Scope): Promise<boolean> {
  return hasScopeServer(scope)
}

/**
 * Capability-based guard. Two failure modes:
 *
 *   - no session                → redirect to /sign-in (anonymous).
 *   - missing scope (any reason — tenant user, non-staff, custom
 *     scope set without this scope) → `notFound()`. We hide the
 *     existence of the surface; a 403 would advertise it.
 *
 * Successful + denied attempts both land in the audit log
 * (`auth.denied`, `important: false`) so probes + accidental clicks
 * stay filterable separately from real activity.
 *
 * STAFF-only convenience: `requireScope` is the right primitive for
 * routes under `/core/admin/*`. For tenant-scoped routes, use
 * `requireScope` from `@iedora/core-auth/server` (which checks both staff
 * and tenant layers).
 */
export async function requireScope(scope: Scope) {
  const h = await headers()
  const session = await getSession()
  if (!session?.user) {
    await recordDenied({ reason: 'no-session', scope, h })
    redirect(signInUrl())
  }
  if (!(await userHasScope(session.user.id, scope))) {
    await recordDenied({ reason: 'no-scope', scope, session, h })
    notFound()
  }
  return session
}
