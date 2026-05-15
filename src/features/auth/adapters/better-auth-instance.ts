import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins/organization'
import { db } from '@/shared/db/client'
import * as schema from '@/shared/db/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
    },
  }),
  trustedOrigins: [
    "https://metamenu.733113.xyz",
  ],
  emailAndPassword: {
    enabled: true,
  },
  rateLimit: {
    // Default in production is on; we disable it explicitly when E2E tests run
    // (they create dozens of users in a tight loop). Re-enable when wiring up
    // a real rate-limit store backed by Redis for prod.
    enabled: process.env.DISABLE_AUTH_RATE_LIMIT !== 'true',
  },
  plugins: [organization()],
})

export type Session = typeof auth.$Infer.Session
