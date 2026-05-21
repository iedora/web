import { createHmac, timingSafeEqual } from 'node:crypto'
import { expandRolesToScopes } from './bundles'
import { IEDORA_ADMIN_ROLE } from './roles'

/**
 * Pure-function core of the Zitadel Actions v2 webhook (route handler
 * lives in `src/app/api/zitadel/permissions/route.ts`). Split out so
 * tests exercise the security-critical bits without standing up
 * NextRequest/NextResponse.
 */

export const FIVE_MINUTES_SEC = 5 * 60

export type SignatureVerdict = { ok: true } | { ok: false; error: string }

type ZitadelFunctionEvent = {
  function?: string
  user?: {
    id?: string
    human?: { email?: string }
  }
  org?: { id?: string }
  user_grants?: Array<{ roles?: string[] }>
}

/**
 * Verify a `ZITADEL-Signature: t=<unix>,v1=<hex>` header against the raw
 * request body using HMAC-SHA256 keyed by the per-target signing key
 * (computed `signing_key` of `zitadel_action_target` in TF).
 *
 * Rejects stale timestamps (> ±5 minutes from `nowSec`) to bound the
 * replay window. `nowSec` is a parameter so tests can pin the clock.
 */
export function verifyZitadelSignature(
  header: string | null | undefined,
  rawBody: string,
  signingKey: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): SignatureVerdict {
  if (!header) return { ok: false, error: 'missing signature' }

  const parts: Record<string, string> = {}
  for (const segment of header.split(',')) {
    const [k, v] = segment.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  }
  const ts = parts.t
  const sig = parts.v1
  if (!ts || !sig) return { ok: false, error: 'malformed signature header' }

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return { ok: false, error: 'bad timestamp' }
  if (Math.abs(nowSec - tsNum) > FIVE_MINUTES_SEC) {
    return { ok: false, error: 'stale timestamp' }
  }

  const expected = createHmac('sha256', signingKey)
    .update(`${ts}.${rawBody}`)
    .digest('hex')

  // timingSafeEqual requires equal-length buffers; mis-length is a
  // priori invalid, short-circuit cleanly.
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(sig, 'hex')
  if (a.length === 0 || a.length !== b.length) {
    return { ok: false, error: 'bad signature' }
  }
  if (!timingSafeEqual(a, b)) return { ok: false, error: 'bad signature' }
  return { ok: true }
}

/**
 * Parse the `IEDORA_ADMIN_EMAILS` env var (comma-separated emails) into
 * a Set for O(1) membership. Empty/whitespace entries dropped.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!raw) return out
  for (const e of raw.split(',')) {
    const trimmed = e.trim().toLowerCase()
    if (trimmed) out.add(trimmed)
  }
  return out
}

/**
 * Closure dependencies the webhook needs to self-heal grants. Tests inject
 * fakes; production wires the real Zitadel mgmt API call + session store.
 */
export type WebhookDeps = {
  /** `IEDORA_ADMIN_EMAILS` parsed. */
  adminEmails: Set<string>
  /**
   * Posts a user grant via Zitadel mgmt API. Returns true on success
   * (including idempotent ALREADY_EXISTS), false on hard failure.
   */
  grantIedoraAdmin: (
    userId: string,
    orgId: string,
  ) => Promise<boolean>
  /**
   * Optional hook to push the freshly-resolved permission set onto every
   * active menu session for the user. Closes the loop on grant changes:
   * the next request the user makes (no re-auth) sees the new scopes.
   *
   * Receives the resolved roles + permissions and the userId. The route
   * wires `sessionStore.refreshPermissionsForUser`; tests pass a spy.
   * Errors are swallowed inside the webhook — a transient DB issue
   * shouldn't fail the entire token-signing flow.
   */
  refreshSessionsForUser?: (
    userId: string,
    next: { roles: string[]; permissions: string[] },
  ) => Promise<unknown>
}

/**
 * Build the response body the webhook returns to Zitadel:
 * `{ append_claims: [{ key: 'permissions', value: [...] }] }`.
 *
 * Self-healing: if the signing-in user's email is in
 * `deps.adminEmails` AND they don't already hold `iedora-admin`, this
 * function calls `deps.grantIedoraAdmin` inline AND adds
 * `iedora-admin` to the role list before expanding to scopes. The
 * FIRST token therefore already carries the expanded permissions —
 * even on a fresh bootstrap where the TF-side `null_resource.iedora_admin_grants`
 * had no user to grant yet.
 */
export async function buildPermissionsResponse(
  rawBody: string,
  deps: WebhookDeps,
): Promise<{ append_claims: Array<{ key: string; value: unknown }> }> {
  let evt: ZitadelFunctionEvent
  try {
    evt = JSON.parse(rawBody) as ZitadelFunctionEvent
  } catch {
    // Pre-validated by the route handler; defensive fallback returns
    // an empty permission claim (callers fail closed).
    evt = {}
  }
  const roles = new Set<string>(
    (evt.user_grants ?? [])
      .flatMap((g) => g.roles ?? [])
      .filter((r): r is string => typeof r === 'string'),
  )

  // Self-heal: admin email + no iedora-admin grant → grant inline.
  // Side-effect happens BEFORE we expand, so the returned claim already
  // reflects the role we just granted.
  const email = evt.user?.human?.email?.toLowerCase()
  const userId = evt.user?.id
  const orgId = evt.org?.id
  if (
    email &&
    userId &&
    orgId &&
    deps.adminEmails.has(email) &&
    !roles.has(IEDORA_ADMIN_ROLE)
  ) {
    const ok = await deps.grantIedoraAdmin(userId, orgId)
    if (ok) roles.add(IEDORA_ADMIN_ROLE)
  }

  const rolesArr = Array.from(roles)
  const permissions = expandRolesToScopes(rolesArr)

  // Side-effect: fan the resolved set out to the user's open menu
  // sessions so a grant change reflects on their NEXT request instead of
  // requiring re-auth. Swallow errors — the token-signing path must not
  // break on a transient DB hiccup; the existing session's stale
  // permissions are bounded by the cookie TTL and the next refresh of
  // this webhook.
  if (deps.refreshSessionsForUser && userId) {
    try {
      await deps.refreshSessionsForUser(userId, {
        roles: rolesArr,
        permissions,
      })
    } catch (err) {
      console.error('[zitadel-webhook] session refresh failed', err)
    }
  }

  return { append_claims: [{ key: 'permissions', value: permissions }] }
}
