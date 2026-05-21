import 'server-only'
import { env } from '@/shared/env'
import { log } from '@/shared/log'

/**
 * Server-only Zitadel enrichment for the sessions admin UI. Bulk-fetches
 * the user details + auth methods that don't fit inside the menu session
 * row (we don't want to mirror Zitadel's user table — these calls are
 * cross-tenant admin-only and never live on a per-request DAL path).
 *
 * Kept inside the sessions slice (not `@/features/identity`) because the
 * identity port stays narrow on purpose — its job is "is this user a
 * member of org X" for tenant scoping. Admin enrichment is a different
 * use case with looser failure semantics (rendering "—" is fine when
 * Zitadel is down; tenant DAL must not be).
 */

export type ZitadelUserSummary = {
  userId: string
  /** Username (loginname stem). May equal preferredLoginName. */
  username: string
  /** Pretty display name when available — falls back to username. */
  displayName: string
  /** Email used to log in. */
  email: string | null
  emailVerified: boolean
  /** USER_STATE_ACTIVE / INACTIVE / LOCKED / INITIAL. */
  state: ZitadelUserState
  /** ISO timestamp of last user-table change (creation / role update / state flip). */
  changedAt: string | null
}

export type ZitadelUserState =
  | 'active'
  | 'inactive'
  | 'locked'
  | 'initial'
  | 'deleted'
  | 'unknown'

const STATE_MAP: Record<string, ZitadelUserState> = {
  USER_STATE_ACTIVE: 'active',
  USER_STATE_INACTIVE: 'inactive',
  USER_STATE_LOCKED: 'locked',
  USER_STATE_INITIAL: 'initial',
  USER_STATE_DELETED: 'deleted',
}

type ZitadelUserRaw = {
  userId?: string
  username?: string
  preferredLoginName?: string
  state?: string
  details?: { changeDate?: string }
  human?: {
    profile?: { givenName?: string; familyName?: string; displayName?: string }
    email?: { email?: string; isVerified?: boolean }
  }
  machine?: { name?: string; description?: string }
}

function parseUser(u: ZitadelUserRaw): ZitadelUserSummary | null {
  const userId = u.userId
  if (!userId) return null
  const username = u.username ?? u.preferredLoginName ?? userId
  const givenName = u.human?.profile?.givenName ?? ''
  const familyName = u.human?.profile?.familyName ?? ''
  const profileDisplay = u.human?.profile?.displayName
  const machineDisplay = u.machine?.name
  const displayName =
    profileDisplay && profileDisplay.trim()
      ? profileDisplay
      : `${givenName} ${familyName}`.trim() ||
        machineDisplay ||
        username
  return {
    userId,
    username,
    displayName,
    email: u.human?.email?.email ?? null,
    emailVerified: u.human?.email?.isVerified ?? false,
    state: STATE_MAP[u.state ?? ''] ?? 'unknown',
    changedAt: u.details?.changeDate ?? null,
  }
}

/**
 * Bulk-fetch user summaries for an arbitrary set of user ids.
 * One round-trip (Zitadel's ListUsers supports `inUserIdsQuery`),
 * returns a `Map<userId, ZitadelUserSummary>`. Users we can't resolve
 * (deleted, missing) are simply absent from the map; callers render
 * a fallback row.
 *
 * Failure mode: any non-2xx logs + returns the partial set we have
 * (typically empty) — the admin page should still render.
 */
export async function getUserSummaries(
  userIds: ReadonlyArray<string>,
): Promise<Map<string, ZitadelUserSummary>> {
  const out = new Map<string, ZitadelUserSummary>()
  if (userIds.length === 0) return out

  const url = `${env.ZITADEL_ISSUER_URL.replace(/\/$/, '')}/v2/users`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ZITADEL_MANAGEMENT_TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        queries: [{ inUserIdsQuery: { userIds: [...userIds] } }],
      }),
    })
  } catch (err) {
    log.error(
      { err, module: 'sessions', endpoint: 'list-users' },
      'zitadel enrichment fetch threw',
    )
    return out
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.error(
      { module: 'sessions', endpoint: 'list-users', status: res.status, body },
      'zitadel enrichment non-2xx',
    )
    return out
  }
  let body: { result?: ZitadelUserRaw[] }
  try {
    body = (await res.json()) as { result?: ZitadelUserRaw[] }
  } catch {
    return out
  }
  for (const u of body.result ?? []) {
    const parsed = parseUser(u)
    if (parsed) out.set(parsed.userId, parsed)
  }
  return out
}

/**
 * Per-user MFA method list. Zitadel returns a flat array of enum
 * strings — we normalize them to UI-friendly tokens and drop the
 * `TYPE_PASSWORD` (every human has a password; surfacing it as MFA is
 * misleading).
 *
 * Issued one call per user; the page caller batches via Promise.all.
 * For larger user counts a per-org cache would be the next step.
 */
export type AuthMethod = 'totp' | 'u2f' | 'passkey' | 'otp_sms' | 'otp_email' | 'idp' | 'password'

const AUTH_METHOD_MAP: Record<string, AuthMethod> = {
  AUTHENTICATION_METHOD_TYPE_PASSWORD: 'password',
  AUTHENTICATION_METHOD_TYPE_PASSKEY: 'passkey',
  AUTHENTICATION_METHOD_TYPE_IDP: 'idp',
  AUTHENTICATION_METHOD_TYPE_TOTP: 'totp',
  AUTHENTICATION_METHOD_TYPE_U2F: 'u2f',
  AUTHENTICATION_METHOD_TYPE_OTP_SMS: 'otp_sms',
  AUTHENTICATION_METHOD_TYPE_OTP_EMAIL: 'otp_email',
}

export async function listAuthMethods(userId: string): Promise<AuthMethod[]> {
  const url = `${env.ZITADEL_ISSUER_URL.replace(/\/$/, '')}/v2/users/${encodeURIComponent(userId)}/authentication_methods`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.ZITADEL_MANAGEMENT_TOKEN}`,
        accept: 'application/json',
      },
      cache: 'no-store',
    })
  } catch (err) {
    log.error(
      { err, module: 'sessions', endpoint: 'list-auth-methods', userId },
      'zitadel auth-methods fetch threw',
    )
    return []
  }
  if (!res.ok) return []
  let body: { authMethodTypes?: string[] }
  try {
    body = (await res.json()) as { authMethodTypes?: string[] }
  } catch {
    return []
  }
  const methods = (body.authMethodTypes ?? [])
    .map((m) => AUTH_METHOD_MAP[m])
    .filter((m): m is AuthMethod => Boolean(m))
  return methods
}

/**
 * Convenience: fetch auth methods for many users in parallel,
 * dedupe-fast on the set of distinct ids. Returns a Map; missing
 * entries render as 0 MFA methods.
 */
export async function getAuthMethodsBulk(
  userIds: ReadonlyArray<string>,
): Promise<Map<string, AuthMethod[]>> {
  const distinct = Array.from(new Set(userIds))
  const entries = await Promise.all(
    distinct.map(async (id) => [id, await listAuthMethods(id)] as const),
  )
  return new Map(entries)
}
