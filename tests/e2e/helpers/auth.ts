import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import { testDb } from './db'

export type TestUser = {
  email: string
  password: string
  name: string
}

let counter = 0
export function uniqueUser(label = 'user'): TestUser {
  counter += 1
  const stamp = `${Date.now()}-${counter}`
  return {
    email: `e2e-${label}-${stamp}@test.local`,
    password: 'Password123!',
    name: `E2E ${label} ${counter}`,
  }
}

export function uniqueSlug(prefix = 'r'): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`.toLowerCase()
}

/**
 * Hits Better Auth's signup endpoint via the running app. Returns the user data
 * and a Playwright-compatible storageState payload (cookies) for the new session.
 */
export async function apiSignup(request: APIRequestContext, user: TestUser) {
  const res = await request.post('/api/auth/sign-up/email', {
    data: { email: user.email, password: user.password, name: user.name },
  })
  expect(res.ok(), `signup failed: ${res.status()} ${await res.text()}`).toBe(true)
  return res.json()
}

export async function apiSignin(request: APIRequestContext, user: TestUser) {
  const res = await request.post('/api/auth/sign-in/email', {
    data: { email: user.email, password: user.password },
  })
  expect(res.ok(), `signin failed: ${res.status()} ${await res.text()}`).toBe(true)
  return res.json()
}

export async function apiSignout(request: APIRequestContext) {
  // Empty `data: {}` so Playwright sets Content-Type: application/json. Better
  // Auth rejects sign-out without an explicit JSON content-type with a 415.
  const res = await request.post('/api/auth/sign-out', { data: {} })
  expect(res.ok(), `signout failed: ${res.status()} ${await res.text()}`).toBe(true)
}

/**
 * Mirrors the onboarding server action: creates an organization, activates it
 * on the caller's session, then inserts a restaurant row in the same tenant.
 * The restaurant insert goes directly to the DB (test seeding only) instead of
 * round-tripping through a yet-to-exist HTTP endpoint.
 */
export async function apiCreateAndActivateOrg(
  request: APIRequestContext,
  name: string,
  slug: string,
) {
  const create = await request.post('/api/auth/organization/create', {
    data: { name, slug },
  })
  expect(create.ok(), `org create failed: ${create.status()} ${await create.text()}`).toBe(true)
  const org = await create.json()

  const setActive = await request.post('/api/auth/organization/set-active', {
    data: { organizationId: org.id },
  })
  expect(setActive.ok(), `set-active failed: ${setActive.status()}`).toBe(true)

  const sql = testDb()
  const [{ id: restaurantId }] = await sql<{ id: string }[]>`
    INSERT INTO restaurant (id, organization_id, name, slug)
    VALUES (gen_random_uuid()::text, ${org.id}, ${name}, ${slug})
    RETURNING id
  `
  const [{ id: menuId }] = await sql<{ id: string }[]>`
    INSERT INTO menu (id, restaurant_id, name, position, updated_at)
    VALUES (gen_random_uuid()::text, ${restaurantId}, 'Main menu', 0, now())
    RETURNING id
  `

  return { ...(org as { id: string; name: string; slug: string }), restaurantId, menuId }
}
