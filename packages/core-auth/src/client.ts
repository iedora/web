import { createAuthClient } from 'better-auth/react'

/**
 * Browser-side auth client. Mirrors the plugin set configured in
 * `./auth.ts` (today: just email+password + cross-subdomain cookies).
 *
 * Tenant / scope mutations are NOT exposed through this client —
 * they're our own server actions backed by `@iedora/core-auth/server`
 * helpers, so the browser never holds AC-bound types and the cross-
 * product contract stays simple.
 *
 * `baseURL` defaults to same-origin — every iedora product hosts its
 * own `/api/auth/*` proxy that forwards to the canonical auth
 * instance, so the client never points cross-domain.
 *
 * Consumers do:
 *   ```ts
 *   import { authClient } from '@iedora/core-auth/client'
 *   const { data } = await authClient.signIn.email({ email, password })
 *   ```
 */
export const authClient = createAuthClient({})

export type AuthClient = typeof authClient
