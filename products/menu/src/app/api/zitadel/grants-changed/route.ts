import { NextRequest, NextResponse } from 'next/server'
import { verifyZitadelSignature } from '@/features/auth/zitadel-webhook'
import {
  handleGrantEvent,
  type GrantsLookup,
} from '@/features/auth/zitadel-grants-webhook'
import { refreshPermissionsForUser } from '@/features/sessions'
import { env } from '@/shared/env'

/**
 * Zitadel Actions v2 EVENT webhook — fires on grant lifecycle changes
 * (`user.grant.{added,changed,cascade.changed,removed,cascade.removed,
 * deactivated,reactivated}`). Bound to `zitadel_action_target.menu_grants`
 * in TF, with 7× `zitadel_action_execution_event` resources fanning each
 * event type into this single target.
 *
 * Pipeline:
 *   1. Verify HMAC signature (same scheme as the function webhook, but
 *      a SEPARATE signing key — each target has its own).
 *   2. Parse the event envelope + payload.
 *   3. Look up the user's CURRENT iedora-project grant via Zitadel mgmt
 *      API (the payload alone isn't authoritative for cascade events).
 *   4. Expand role keys to scopes and push to every active menu session.
 *
 * Failure modes:
 *   - Missing signing key (rollout hasn't finished applying TF yet) →
 *     503 + log. Zitadel retries; the retry succeeds once the env var
 *     is in place.
 *   - Bad signature / stale timestamp → 401, no body.
 *   - Mgmt API down → 200 with `{ok:false, error}`. Zitadel doesn't
 *     retry on 2xx, so we eat the event. Next login still refreshes
 *     via the function webhook — the existing fallback.
 */

/**
 * Production grants-lookup adapter — calls the Zitadel mgmt API with
 * the menu-sa PAT. Filters by user_id; returns role keys for the
 * matching iedora-project grant (typically exactly one row).
 */
const lookupGrants: GrantsLookup = async (userId, projectId) => {
  const url = `${env.ZITADEL_ISSUER_URL.replace(/\/$/, '')}/management/v1/users/grants/_search`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.ZITADEL_MANAGEMENT_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      queries: [{ userIdQuery: { userId } }],
    }),
  })
  if (!res.ok) {
    throw new Error(`zitadel grants search ${res.status}`)
  }
  const body = (await res.json()) as {
    result?: Array<{ projectId?: string; roleKeys?: string[]; state?: string }>
  }
  const grants = body.result ?? []
  // Only the iedora project, only active state. (`USER_GRANT_STATE_ACTIVE` per
  // the proto; deactivated grants appear with state=INACTIVE.)
  const roleKeys = new Set<string>()
  for (const g of grants) {
    if (g.projectId !== projectId) continue
    if (g.state && g.state !== 'USER_GRANT_STATE_ACTIVE') continue
    for (const r of g.roleKeys ?? []) roleKeys.add(r)
  }
  return Array.from(roleKeys)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!env.ZITADEL_GRANTS_SIGNING_KEY) {
    return NextResponse.json(
      { error: 'grants webhook not configured' },
      { status: 503 },
    )
  }
  const rawBody = await req.text()
  const verdict = verifyZitadelSignature(
    req.headers.get('zitadel-signature'),
    rawBody,
    env.ZITADEL_GRANTS_SIGNING_KEY,
  )
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: 401 })
  }

  const result = await handleGrantEvent(rawBody, {
    iedoraProjectId: env.IEDORA_PROJECT_ID,
    lookupGrants,
    refreshSessionsForUser: refreshPermissionsForUser,
  })
  return NextResponse.json(result)
}
