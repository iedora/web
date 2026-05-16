import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins/organization'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { db } from '@/shared/db/client'
import * as schema from '@/shared/db/schema'
import { env } from '@/shared/env'

// Generic over the driver — accepts both postgres-js (prod) and PGLite (tests).
type AuthDb = PgDatabase<PgQueryResultHKT, typeof schema>

// Every model Better Auth touches at runtime, given our plugin set:
//   core (email+password) → user, session, account, verification
//   organization plugin   → organization, member, invitation
//   rateLimit.storage='database' → rateLimit
//
// Exported so tests can assert completeness against a known-good list — if
// you enable a Better Auth plugin or storage option that adds a new model,
// register it here AND mirror it on `BA_MODELS` so the integration test
// catches the wiring gap before it ships.
export const BA_MODELS = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
  organization: schema.organization,
  member: schema.member,
  invitation: schema.invitation,
  rateLimit: schema.rateLimit,
} as const

/**
 * Factory. Production uses the singleton at the bottom; tests construct
 * their own instance pointed at a PGLite db to exercise the real adapter
 * wiring (e.g. catch "model X not found in schema object" before deploy).
 */
export function makeAuth(database: AuthDb) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: BA_MODELS,
    }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
    },
    // DB-backed rate limit + sessions. We're single-node, so the secondaryStorage
    // pattern (caching across nodes) is redundancy without a payoff. Postgres
    // handles the volume — Better Auth's `rateLimit.storage: 'database'` uses
    // the same Drizzle connection that backs sessions/users/orgs.
    rateLimit: {
      enabled: process.env.DISABLE_AUTH_RATE_LIMIT !== 'true',
      storage: 'database',
    },
    // Trust cloudflared's CF-Connecting-IP only; X-Forwarded-For is spoofable
    // upstream of the tunnel. ipv6Subnet: 64 mitigates CVE-2026-45364 (attackers
    // walking a /64 to evade per-IP throttles).
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
        ipv6Subnet: 64,
      },
    },
    plugins: [organization()],
  })
}

export const auth = makeAuth(db)

export type Session = typeof auth.$Infer.Session
