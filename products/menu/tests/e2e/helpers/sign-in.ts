import { randomBytes } from 'node:crypto'
import { type BrowserContext } from '@playwright/test'
import { makeSessionCookie } from '../../../src/features/auth/adapters/session'
import { testDb } from './db'

export type SignInUser = {
  email: string
  name: string
}

const MENU_TEST_SECRET =
  'test-secret-do-not-use-in-prod-test-secret-do-not-use-in-prod'

export type SignedInUser = {
  userId: string
  email: string
  name: string
  sessionId: string
}

export async function signInAs(
  context: BrowserContext,
  user: SignInUser,
): Promise<SignedInUser> {
  const userId = `usr_${randomBytes(12).toString('hex')}`
  const sessionId = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  // Insert mock session row directly in PostgreSQL.
  // We grant 'iedora-admin' role and write/read permissions for QR codes.
  const sql = testDb()
  await sql`
    INSERT INTO "menu"."session" (
      id, user_id, email, name, roles, permissions,
      permissions_version, created_at, last_seen_at, expires_at
    )
    VALUES (
      ${sessionId},
      ${userId},
      ${user.email},
      ${user.name},
      ${JSON.stringify(['iedora-admin'])},
      ${JSON.stringify(['qr-codes:write', 'qr-codes:read'])},
      1,
      now(),
      now(),
      ${expiresAt}
    )
  `

  // Seal the opaque pointer session cookie (JWEalg=dir, enc=A256GCM).
  const sessions = makeSessionCookie(MENU_TEST_SECRET)
  const jwe = await sessions.seal({
    sid: sessionId,
    sub: userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  })

  // Inject cookie into the Playwright browser context.
  await context.addCookies([
    {
      name: 'menu_session_v2',
      value: jwe,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false, // http://localhost in test is fine
      sameSite: 'Lax',
      expires: Math.floor(expiresAt.getTime() / 1000),
    },
  ])

  return { userId, email: user.email, name: user.name, sessionId }
}
