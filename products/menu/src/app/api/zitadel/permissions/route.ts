import { NextRequest, NextResponse } from 'next/server'
import {
  buildPermissionsResponse,
  parseAdminEmails,
  verifyZitadelSignature,
  type WebhookDeps,
} from '@/features/auth/zitadel-webhook'
import { IEDORA_ADMIN_ROLE } from '@/features/auth/roles'
import { env } from '@/shared/env'

/**
 * Zitadel Actions v2 webhook — bundle expansion + self-heal of admin grants.
 *
 * Bound to two function executions in TF (`preuserinfo` + `preaccesstoken`)
 * on `zitadel_action_target.menu_permissions`. Zitadel POSTs the
 * authentication context here right before signing the id_token /
 * access_token / userinfo. We expand the user's bundle role-grants via
 * `BUNDLES` and return them under `append_claims.permissions`.
 *
 * Self-heal: when the signing-in user is in `IEDORA_ADMIN_EMAILS` and
 * has no `iedora-admin` grant yet (the typical case on the very first
 * OIDC login, because Zitadel auto-provisions the user only at that
 * moment and the TF-side grant helper saw "no such email" earlier),
 * the webhook calls Zitadel's mgmt API to POST the grant inline AND
 * includes `iedora-admin` in the response's expanded scopes — so the
 * FIRST token already carries the right permissions claim.
 *
 * Security boundary lives in `verifyZitadelSignature` (HMAC-SHA256 over
 * `${ts}.${rawBody}` with the per-target signing key) — see the
 * co-located `zitadel-webhook.test.ts` for the negative cases.
 *
 * In dev, `zitadel_action_target.timeout = 5s` + `interrupt_on_error = false`
 * mean a slow / down webhook gracefully degrades: tokens still get
 * signed, just without the `permissions` claim. The DAL guards
 * (`requireScope`) handle that case as "no permission" — fail closed.
 */

const adminEmails = parseAdminEmails(env.IEDORA_ADMIN_EMAILS)

async function grantIedoraAdmin(userId: string, orgId: string): Promise<boolean> {
  if (!env.IEDORA_PROJECT_ID || !env.ZITADEL_MANAGEMENT_TOKEN || !env.ZITADEL_ISSUER_URL) {
    return false
  }
  const url = `${env.ZITADEL_ISSUER_URL.replace(/\/$/, '')}/management/v1/users/${encodeURIComponent(userId)}/grants`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.ZITADEL_MANAGEMENT_TOKEN}`,
      'Content-Type': 'application/json',
      'x-zitadel-orgid': orgId,
    },
    body: JSON.stringify({
      projectId: env.IEDORA_PROJECT_ID,
      roleKeys: [IEDORA_ADMIN_ROLE],
    }),
  })
  if (res.ok) return true
  // Zitadel returns 409 / 412 with code 6 (ALREADY_EXISTS) when the grant
  // is already in place. Treat that as success — the role is set.
  if (res.status === 409 || res.status === 412) {
    try {
      const body = (await res.json()) as { code?: number }
      if (body.code === 6) return true
    } catch {
      // fall through
    }
  }
  // Real failure — log on the server console; the webhook returns the
  // permissions it could compute (empty), Zitadel signs the token without
  // the claim, and `requireScope` fails closed downstream.
  console.error(
    `[zitadel/permissions] grant failed: HTTP ${res.status} for user ${userId}`,
  )
  return false
}

const deps: WebhookDeps = { adminEmails, grantIedoraAdmin }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()

  const verdict = verifyZitadelSignature(
    req.headers.get('zitadel-signature'),
    rawBody,
    env.ZITADEL_ACTION_SIGNING_KEY,
  )
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: 401 })
  }

  try {
    JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'malformed body' }, { status: 400 })
  }

  return NextResponse.json(await buildPermissionsResponse(rawBody, deps))
}
