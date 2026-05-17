import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { user as userTable } from '@iedora/auth-testkit/schema'
import { startTestGenkan, type TestGenkanHandle } from '@iedora/auth-testkit'

/**
 * Regression pin for audit register #20 (Role escalation via mass-assignment).
 *
 * Mitigation: `user.additionalFields.role.input = false` on the Better Auth
 * config (`better-auth-instance.ts`). With this flag, Better Auth REJECTS
 * any sign-up body that tries to set `role` — it doesn't silently drop the
 * field, it throws an APIError. That's a stronger guarantee than "the
 * extra field is ignored."
 *
 * Without this test, a Better Auth upgrade that softens the default — or a
 * careless config edit that drops `input: false` — would silently let a
 * public POST to `/api/auth/sign-up/email` mint an admin user with no
 * indication of the regression in unit tests.
 *
 * The test boots a real Better Auth via the auth-testkit (same plugin set
 * + same `input: false` config as production genkan) and asserts both:
 *   1. The signup REJECTS when `role` is in the body.
 *   2. A clean signup (no `role` field) lands with the default role `user`.
 */

let handle: TestGenkanHandle

beforeAll(async () => {
  handle = await startTestGenkan({ clients: [] })
})

afterAll(async () => {
  await handle.stop()
})

describe('role escalation via signup', () => {
  it('rejects signup when the body contains role:"admin"', async () => {
    await expect(
      handle.auth.api.signUpEmail({
        body: {
          name: 'Eve',
          email: 'eve@example.com',
          password: 'correct-horse-battery-staple-1234',
          ...({ role: 'admin' } as Record<string, unknown>),
        } as NonNullable<Parameters<typeof handle.auth.api.signUpEmail>[0]>['body'],
      }),
    ).rejects.toThrow(/role is not allowed to be set/i)
  })

  it('rejects signup when the body contains role:"super" or other forbidden fields', async () => {
    await expect(
      handle.auth.api.signUpEmail({
        body: {
          name: 'Mallory',
          email: 'mallory@example.com',
          password: 'correct-horse-battery-staple-9876',
          ...({ role: 'super' } as Record<string, unknown>),
        } as NonNullable<Parameters<typeof handle.auth.api.signUpEmail>[0]>['body'],
      }),
    ).rejects.toThrow(/role is not allowed to be set/i)
  })

  it('accepts a clean signup and lands the user with the default role', async () => {
    const result = (await handle.auth.api.signUpEmail({
      body: {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple-2222',
      },
    })) as { user: { id: string } }

    const [row] = await handle.db
      .select({ role: userTable.role })
      .from(userTable)
      .where(eq(userTable.id, result.user.id))
      .limit(1)
    expect(row?.role).toBe('user') // default — NOT 'admin'
  })
})
