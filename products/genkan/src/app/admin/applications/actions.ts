'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/features/admin'
import { requireFreshSession } from '@/features/auth'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { rotateJwks } from '@/features/auth/use-cases/rotate-jwks'
import { db } from '@/shared/db/client'
import { oauthClient } from '@/shared/db/schema'
import { recordAdminEvent } from '../_lib/audit'

type Result = { ok: true } | { ok: false; error: string }
type RegisterResult =
  | {
      ok: true
      clientId: string
      internalId: string
    }
  | { ok: false; error: string }

function toMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const obj = e as { message?: unknown; body?: { message?: unknown } }
    if (typeof obj.message === 'string') return obj.message
    if (obj.body && typeof obj.body.message === 'string') return obj.body.message
  }
  return fallback
}

function splitLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export async function registerApplicationAction(
  formData: FormData,
): Promise<RegisterResult> {
  const adminSession = await requireAdmin()
  const clientName = String(formData.get('client_name') ?? '').trim()
  const redirectUris = splitLines(
    String(formData.get('redirect_uris') ?? ''),
  )
  const scopes = formData.getAll('scope').map((s) => String(s)).filter(Boolean)

  if (!clientName) return { ok: false, error: 'Name is required.' }
  if (redirectUris.length === 0) {
    return { ok: false, error: 'At least one redirect URI is required.' }
  }
  for (const uri of redirectUris) {
    try {
      // Validate that each line is a real absolute URL.
      const u = new URL(uri)
      if (!u.protocol.startsWith('http')) {
        return { ok: false, error: `Invalid redirect URI: ${uri}` }
      }
    } catch {
      return { ok: false, error: `Invalid redirect URI: ${uri}` }
    }
  }

  const scope = scopes.length > 0 ? scopes.join(' ') : undefined

  try {
    const result = await auth.api.registerOAuthClient({
      headers: await headers(),
      body: {
        client_name: clientName,
        redirect_uris: redirectUris,
        ...(scope ? { scope } : {}),
      },
    })
    const clientId = (result as { client_id?: string } | undefined)?.client_id
    if (!clientId) {
      return { ok: false, error: 'Registration succeeded but no client_id was returned.' }
    }
    // Look up the internal id so we can redirect into the detail page.
    const [row] = await db
      .select({ id: oauthClient.id })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1)
    // Record name + redirect_uris but never the client_secret — the
    // payload is intentionally non-sensitive (it lands in a queryable
    // table that ops eyeballs on a regular basis).
    const audit = await recordAdminEvent(
      {
        action: 'app.register',
        targetId: row?.id ?? clientId,
        payload: { name: clientName, redirect_uris: redirectUris },
      },
      adminSession,
    )
    if (!audit.ok) {
      return { ok: false, error: audit.error }
    }
    revalidatePath('/admin/applications')
    return {
      ok: true,
      clientId,
      internalId: row?.id ?? '',
    }
  } catch (e) {
    return {
      ok: false,
      error: toMessage(e, 'Could not register application.'),
    }
  }
}

/**
 * Manually rotate the JWKS active signing key. Used for compromised-key
 * emergencies — the 90-day automatic cadence runs from
 * `@/features/auth/cron`.
 *
 * Step-up gated (`requireFreshSession`) because key rotation is a
 * destructive op even though existing tokens still validate against the
 * retained old key. A leaked-key scenario is the very situation where you
 * want the actor to reauthenticate before pressing the button.
 */
export async function rotateJwksAction(): Promise<
  { ok: true; newKeyId: string } | { ok: false; error: string }
> {
  await requireAdmin()
  await requireFreshSession({ returnTo: '/admin/applications' })
  const result = await rotateJwks({ force: true })
  if (!result.ok) return { ok: false, error: result.error }
  if (!result.rotated) {
    // Shouldn't happen — `force: true` skips the recency guard. Surface
    // as an error so the UI shows it instead of silently claiming success.
    return { ok: false, error: 'Rotation skipped unexpectedly.' }
  }
  revalidatePath('/admin/applications')
  return { ok: true, newKeyId: result.newKeyId }
}

export async function deleteApplicationAction(
  internalId: string,
): Promise<Result> {
  const adminSession = await requireAdmin()
  await requireFreshSession({ returnTo: `/admin/applications/${internalId}` })
  try {
    await db.delete(oauthClient).where(eq(oauthClient.id, internalId))
  } catch (e) {
    return {
      ok: false,
      error: toMessage(e, 'Could not delete application.'),
    }
  }
  const audit = await recordAdminEvent(
    { action: 'app.delete', targetId: internalId },
    adminSession,
  )
  if (!audit.ok) return audit
  revalidatePath('/admin/applications')
  redirect('/admin/applications')
}
