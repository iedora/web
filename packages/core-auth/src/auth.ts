import 'server-only'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { getCoreDb } from './db'
import { schema } from './schema'
import { IEDORA_ADMIN_ROLE, STAFF_ROLE_PRESETS, detectStaffPreset } from './role-presets'
import { recordAudit } from './audit'

/**
 * The canonical iedora auth instance. Every product imports this — there
 * is no second configuration anywhere in the estate. Cookies seal on the
 * parent domain (`.iedora.com` in prod, `localhost` in dev) so a session
 * created on one product surface (e.g. core.iedora.com sign-in) is
 * readable by another (menu.iedora.com).
 *
 * Initialisation is LAZY (first call to `getAuth()`), not at import time,
 * so:
 *   - `next build` with an empty env doesn't try to open a database
 *     socket while collecting page data.
 *   - Tests can stub `process.env` before importing anything that touches
 *     `auth.api.*`.
 */
let cached: ReturnType<typeof build> | null = null

function build() {
  const baseURL = process.env.CORE_BASE_URL
  const secret = process.env.CORE_SECRET
  const trustedOriginsRaw = process.env.CORE_TRUSTED_ORIGINS ?? ''
  const bootstrapAdminsRaw = process.env.IEDORA_BOOTSTRAP_ADMIN_EMAILS ?? ''

  if (!baseURL || !secret) {
    throw new Error(
      '[iedora/auth] CORE_BASE_URL and CORE_SECRET must be set.',
    )
  }

  const trustedOrigins = trustedOriginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // CSV of emails auto-promoted to `iedora-admin` on signup — covers
  // the founding account so the first deploy doesn't need a manual
  // SQL UPDATE. Anything else lands via the admin UI.
  const bootstrapAdminEmails = new Set(
    bootstrapAdminsRaw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins,
    database: drizzleAdapter(getCoreDb(), {
      provider: 'pg',
      schema,
      usePlural: false,
    }),
    user: {
      // Declare every column we layered onto `core.user` beyond
      // better-auth's built-in shape. WITHOUT this, the drizzle
      // adapter silently strips unknown keys from any insert /
      // update payload — including the `scopes` array set by the
      // bootstrap-admin hook below. The columns existed in the
      // previous deployments via better-auth's `admin` + `organization`
      // plugins; we dropped the plugins but kept the columns, so the
      // declarations have to live here now.
      //
      // `input: false` blocks the field from being written through the
      // public sign-up form — only server-side code (hooks, our own
      // primitives in `./staff`) may touch it.
      additionalFields: {
        scopes: { type: 'string[]', required: false, defaultValue: null, input: false },
        banned: { type: 'boolean', required: false, defaultValue: false, input: false },
        banReason: { type: 'string', required: false, defaultValue: null, input: false },
        banExpires: { type: 'date', required: false, defaultValue: null, input: false },
      },
    },
    session: {
      // Same story for session-level columns: `activeTenantId` (our
      // tenancy pin) and `impersonatedBy` (admin act-as) were
      // managed by the org + admin plugins; declare them so
      // `setActiveTenant` / `impersonateUser` actually persist.
      additionalFields: {
        activeTenantId: { type: 'string', required: false, defaultValue: null, input: false },
        impersonatedBy: { type: 'string', required: false, defaultValue: null, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Bootstrap the founding iedora-admin on first signup. Sets
          // `user.scopes` to the iedora-admin preset (every staff
          // scope) so the founder lands in the admin surface without
          // a post-deploy SQL UPDATE. Idempotent: only fires on row
          // creation.
          before: async (user) => {
            if (bootstrapAdminEmails.has(user.email.toLowerCase())) {
              return {
                data: {
                  ...user,
                  scopes: [...STAFF_ROLE_PRESETS[IEDORA_ADMIN_ROLE]],
                },
              }
            }
            return { data: user }
          },
          after: async (user) => {
            const promoted = bootstrapAdminEmails.has(user.email.toLowerCase())
            // `detectStaffPreset` reverse-maps the scope array back to
            // the named preset for audit display ("iedora-admin").
            const scopes = (user.scopes as string[] | undefined) ?? null
            const presetLabel = scopes ? detectStaffPreset(scopes as never) : null
            await recordAudit({
              event: 'user.signed-up',
              outcome: 'success',
              actor: {
                userId: user.id,
                role: presetLabel,
                email: user.email,
              },
              target: { userId: user.id },
              meta: promoted
                ? { bootstrapAdminPromotion: true }
                : null,
              important: true,
            })
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await recordAudit({
              event: 'user.signed-in',
              outcome: 'success',
              actor: { userId: session.userId },
              target: { userId: session.userId, sessionId: session.id },
              meta: {
                ipAddress: session.ipAddress ?? null,
                impersonatedBy: session.impersonatedBy ?? null,
              },
              important: true,
            })
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Email verification is opt-in for now — we don't have SMTP in the
      // estate yet. When SMTP lands, flip to `true` + wire `sendVerificationEmail`.
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 256,
    },
    advanced: {
      // Parent-domain cookie so menu.iedora.com + core.iedora.com + any
      // future iedora.com surface read the same session. Override with
      // `CORE_COOKIE_DOMAIN` in dev (where `.localhost` is invalid).
      crossSubDomainCookies: {
        enabled: true,
        domain: process.env.CORE_COOKIE_DOMAIN ?? '.iedora.com',
      },
    },
    plugins: [
      // Better-auth's `organization` and `admin` plugins were dropped
      // in the tenancy + scope refactor. Tenants live in our own
      // `core.tenant` / `core.tenant_member` tables (see
      // `./tenants`, `./tenant-members`, `./sessions`). Staff powers
      // live in `user.scopes` (see `./staff`). Both authorisations
      // resolve through `userHasScope` / `hasScope` — no AC binding,
      // no plugin coupling.
      //
      // `nextCookies()` MUST stay last — it patches the response
      // pipeline to ship Set-Cookie headers through Next's server-
      // action boundary correctly.
      nextCookies(),
    ],
  })
}

export function getAuth() {
  if (!cached) cached = build()
  return cached
}

export type Auth = ReturnType<typeof build>
export type AuthSession = Awaited<ReturnType<Auth['api']['getSession']>>

/**
 * Lazy singleton — same instance every product binds to. `getAuth()`
 * is preserved for callers that want the resolved object directly;
 * `auth` is a Proxy that intercepts every access so `next build`
 * collecting page data on an empty env doesn't open a Postgres socket
 * just to satisfy a top-level `import { auth } from '@iedora/core-auth'`.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get: (_t, key) => Reflect.get(getAuth(), key),
})
