import { expandRolesToScopes } from './bundles'

/**
 * Pure-function core of the Zitadel Actions v2 EVENT webhook (route
 * lives in `src/app/api/zitadel/grants-changed/route.ts`).
 *
 * Fires on `user.grant.{added,changed,cascade.changed,removed,
 * cascade.removed,deactivated,reactivated}` — anything that can shift a
 * user's effective scope set. We use the event payload as a TRIGGER and
 * then re-fetch the user's current grants from Zitadel (mgmt API), so
 * deactivate/reactivate edge cases and out-of-order delivery don't
 * surface stale data.
 *
 * The HMAC verification is shared with the function webhook — see
 * `verifyZitadelSignature` in `./zitadel-webhook.ts`.
 */

/**
 * Outer envelope every action target receives — same shape Zitadel
 * builds in `internal/repository/execution/queue.go::ContextInfoEvent`.
 * Only the fields the handler reads are listed.
 */
export type ZitadelEventEnvelope = {
  /** `user.grant.added`, etc. */
  event_type?: string
  /** Per-event payload (raw JSON the aggregate emitted). */
  event_payload?: unknown
  /** The grant aggregate id — useful for log correlation, not used in logic. */
  aggregateID?: string
}

/**
 * Subset of the `user_grant.*` payload we care about. Same json tags as
 * Zitadel's Go event structs (internal/repository/usergrant/user_grant.go).
 * `projectId` is `omitempty` in the Go source — `changed` events only
 * include diff fields, so projectId is absent when only the roles moved.
 * Our handler therefore can't rely on it; we always filter on the menu-
 * side `IEDORA_PROJECT_ID` instead.
 */
type UserGrantPayload = {
  userId?: string
  projectId?: string
  roleKeys?: string[]
}

export type ParsedGrantEvent = {
  /** The SUBJECT — the user whose grant changed. NOT the actor. */
  subjectUserId: string
  /** Role keys carried in the event payload. May be empty (removed event). */
  payloadRoleKeys: string[]
  /** The event type so the handler can branch (removed → empty scope set). */
  eventType: string
}

/**
 * Parse the outer envelope + the user-grant payload. Returns null on
 * any structural mismatch — caller treats that as "unknown event,
 * ignore" rather than crashing the webhook (Zitadel retries on 5xx).
 *
 * Known limitation: `user.grant.deactivated` and `user.grant.reactivated`
 * carry an empty payload in Zitadel (`Payload() returns nil`), so we
 * can't extract the subject userId. Those events return null here and
 * the row's permissions stay stale until the next login. The function
 * webhook (`/api/zitadel/permissions`) still refreshes on the next
 * `preuserinfo`/`preaccesstoken` cycle — bounded by cookie TTL, not the
 * full 7d.
 */
export function parseGrantEvent(rawBody: string): ParsedGrantEvent | null {
  let outer: ZitadelEventEnvelope
  try {
    outer = JSON.parse(rawBody) as ZitadelEventEnvelope
  } catch {
    return null
  }
  const eventType = outer.event_type
  if (typeof eventType !== 'string' || !eventType.startsWith('user.grant.')) {
    return null
  }
  const payload = outer.event_payload as UserGrantPayload | undefined
  if (!payload || typeof payload !== 'object') return null
  const userId = payload.userId
  if (typeof userId !== 'string') return null
  const roleKeys = Array.isArray(payload.roleKeys)
    ? payload.roleKeys.filter((r): r is string => typeof r === 'string')
    : []
  return {
    subjectUserId: userId,
    payloadRoleKeys: roleKeys,
    eventType,
  }
}

/**
 * Whether the event implies the user has NO active iedora roles right
 * now. Cascade-removed + removed are the obvious cases; deactivated
 * also revokes effective access until reactivated.
 */
export function isRemovalEvent(eventType: string): boolean {
  return (
    eventType === 'user.grant.removed' ||
    eventType === 'user.grant.cascade.removed' ||
    eventType === 'user.grant.deactivated'
  )
}

/**
 * Mgmt-API call hook. Production wires `fetch` against
 * `${ZITADEL_ISSUER_URL}/management/v1/users/grants/_search` with the
 * IAM_OWNER PAT, filters to the iedora project + active state, and
 * returns the resolved role keys (an empty list means the user has no
 * active iedora roles right now — collapses to no permissions).
 */
export type GrantsLookup = (
  userId: string,
  projectId: string,
) => Promise<string[]>

/**
 * Resolve the user's effective role keys on the iedora project. For
 * removal-shaped events we short-circuit to `[]`; otherwise we call the
 * mgmt API for the authoritative current set (the event payload only
 * reflects THIS event, not the user's other co-existing roles on the
 * same grant).
 */
export async function resolveCurrentRoles(
  evt: ParsedGrantEvent,
  iedoraProjectId: string,
  lookup: GrantsLookup,
): Promise<string[]> {
  if (isRemovalEvent(evt.eventType)) return []
  // For added/changed/cascade.changed, ask Zitadel what the user's
  // current grants look like and filter to the iedora project. The
  // payload's roleKeys is a strong hint but isn't authoritative — the
  // user might hold a grant we don't see in this event.
  return lookup(evt.subjectUserId, iedoraProjectId)
}

export type RefreshDeps = {
  /** Identifies the iedora project; events for other projects no-op. */
  iedoraProjectId: string
  /** Reads the user's current role keys for a project (Zitadel mgmt API). */
  lookupGrants: GrantsLookup
  /**
   * Pushes the resolved (roles, permissions) set onto every active
   * menu session for the user. Wired to
   * `sessionStore.refreshPermissionsForUser` in production; tests pass
   * a spy.
   */
  refreshSessionsForUser: (
    userId: string,
    next: { roles: string[]; permissions: string[] },
  ) => Promise<unknown>
}

export type HandleResult =
  | { ok: true; userId: string; touched: number; roles: string[]; permissions: string[] }
  | { ok: true; skipped: 'parse_failed' | 'no_iedora_project_id' }
  | { ok: false; error: string }

/**
 * End-to-end handler for the grants-changed event. Returns a structured
 * result the route can serialise to JSON without leaking exception
 * details — the worker is async on Zitadel's side so we always reply
 * 200 if the body was structurally valid, and rely on `ok=true` /
 * `ok=false` for telemetry.
 */
export async function handleGrantEvent(
  rawBody: string,
  deps: RefreshDeps,
): Promise<HandleResult> {
  const evt = parseGrantEvent(rawBody)
  if (!evt) return { ok: true, skipped: 'parse_failed' }
  if (!deps.iedoraProjectId) {
    // Build-time stub / misconfiguration. We can't filter the lookup
    // without the project id, so skip rather than refresh with wrong data.
    return { ok: true, skipped: 'no_iedora_project_id' }
  }
  let roles: string[]
  try {
    roles = await resolveCurrentRoles(evt, deps.iedoraProjectId, deps.lookupGrants)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'grant lookup failed',
    }
  }
  const permissions = expandRolesToScopes(roles)
  let touched = 0
  try {
    const r = await deps.refreshSessionsForUser(evt.subjectUserId, {
      roles,
      permissions,
    })
    touched = typeof r === 'number' ? r : 0
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'session refresh failed',
    }
  }
  return {
    ok: true,
    userId: evt.subjectUserId,
    touched,
    roles,
    permissions,
  }
}
