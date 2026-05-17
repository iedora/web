import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { db } from '@/shared/db/client'
import * as schema from '@/shared/db/schema'
import { env } from '@/shared/env'

// Generic over the driver — accepts both postgres-js (prod) and PGLite (tests).
type AuthDb = PgDatabase<PgQueryResultHKT, typeof schema>

// Every model Better Auth touches at runtime, given our plugin set:
//   core (sessions)                → user, session, account, verification
//   generic-oauth client plugin    → reuses user + account (one row per
//                                     (userId, providerId='genkan'),
//                                     storing the access/refresh tokens)
//   rateLimit.storage='database'   → rateLimit
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
  rateLimit: schema.rateLimit,
} as const

/**
 * Factory. Production uses the singleton at the bottom; tests construct
 * their own instance pointed at a PGLite db to exercise the real adapter
 * wiring (e.g. catch "model X not found in schema object" before deploy).
 *
 * Menu is a pure OAuth CLIENT of Genkan (the IdaaS at genkan.iedora.com).
 * No email/password locally — every sign-in starts with a redirect to
 * Genkan's `/oauth2/authorize`. Better Auth's `generic-oauth` plugin
 * handles the standard OIDC dance and persists the resulting access /
 * refresh tokens in `account` so the identity slice can call Genkan's
 * organization HTTP API on the user's behalf.
 */
export function makeAuth(database: AuthDb) {
  return betterAuth({
    // Pin baseURL explicitly. Better Auth would derive it from
    // env.BETTER_AUTH_URL anyway, but the explicit value is diff-visible at
    // PR review and makes test fixtures deterministic (tests stub env).
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: BA_MODELS,
    }),
    // Trust menu's own origin AND Genkan — sign-out requests from menu
    // POST through to menu's /api/auth, and the OAuth callback comes back
    // from Genkan.
    trustedOrigins: [env.BETTER_AUTH_URL, env.GENKAN_ISSUER_URL],
    // Pin log level in prod — Better Auth's default `info` is noisy and
    // includes token / userinfo payloads in the generic-oauth callback
    // path. Verbose locally.
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'error' : 'info',
      disabled: false,
    },
    // No local credentials. Genkan owns sign-in/sign-up.
    emailAndPassword: {
      enabled: false,
    },
    // Better Auth 1.6.x ships an opt-out telemetry collector. Explicit
    // opt-out for both apps — we don't want third-party observation of
    // identity-adjacent surfaces, and pinning the value makes the posture
    // resilient to a future default flip.
    telemetry: { enabled: false },
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
      // Force Secure + `__Secure-` cookie prefix in every environment.
      // Better Auth's auto-detection (baseURL starts with https://) already
      // lands here in prod, but the explicit flag is diff-visible and
      // resilient to future baseURL refactors. Cloudflared terminates TLS
      // at the edge and forwards HTTP to origin.
      useSecureCookies: true,
      // TODO(hardening): promote to `__Host-` prefix once we've verified
      // neither BA nor any helper sets the Domain attribute. Today menu
      // uses host-only cookies (no crossSubDomainCookies) so the switch is
      // technically safe, but the cookie-name override would invalidate
      // every existing session. Defer to a planned re-auth window.
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: 'genkan',
            clientId: env.GENKAN_OAUTH_CLIENT_ID,
            clientSecret: env.GENKAN_OAUTH_CLIENT_SECRET,
            // Discovery endpoint — generic-oauth fetches the OIDC config
            // (auth URL, token URL, userinfo URL, JWKS) from here so we
            // never hardcode those endpoints.
            discoveryUrl: `${env.GENKAN_ISSUER_URL}/.well-known/openid-configuration`,
            scopes: [
              'openid',
              'profile',
              'email',
              'offline_access',
              'menu',
              'org:read',
              'org:admin',
            ],
            // PKCE is mandatory on Genkan's side (OAuth 2.1 default; the
            // trusted oauth_client row sets require_pkce=true). Without
            // this flag generic-oauth omits the code_challenge param and
            // Genkan rejects the authorize request with
            // `error_description=pkce is required for this client`.
            pkce: true,
          },
        ],
      }),
    ],
  })
}

export const auth = makeAuth(db)

export type Session = typeof auth.$Infer.Session
