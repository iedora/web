import 'server-only'
import * as oidc from 'openid-client'
import { env } from '@/shared/env'

/**
 * Lazy-initialised Zitadel OIDC client. openid-client v6 is functional —
 * discovery returns a `Configuration` object that every subsequent call
 * threads as the first arg.
 *
 * Discovery hits `${ZITADEL_ISSUER_URL}/.well-known/openid-configuration`
 * to populate auth/token/JWKS endpoints. Cached for process lifetime —
 * Zitadel doesn't rotate endpoint URLs.
 */
let cached: Promise<oidc.Configuration> | undefined

function getConfig(): Promise<oidc.Configuration> {
  if (!cached) {
    // openid-client v6 refuses http:// issuer URLs by default. The dev
    // stack runs Zitadel on http://localhost:8080 (no TLS), so we
    // gate the `allowInsecureRequests` execution layer on dev only.
    // Prod stays strict.
    const isHttpIssuer = env.ZITADEL_ISSUER_URL.startsWith('http://')
    cached = oidc.discovery(
      new URL(env.ZITADEL_ISSUER_URL),
      env.ZITADEL_OAUTH_CLIENT_ID,
      env.ZITADEL_OAUTH_CLIENT_SECRET,
      // BASIC: client_id + client_secret sent in the Authorization header
      // on the token endpoint. Matches OIDC_AUTH_METHOD_TYPE_BASIC on the
      // TF-declared OIDC app.
      oidc.ClientSecretBasic(env.ZITADEL_OAUTH_CLIENT_SECRET),
      isHttpIssuer ? { execute: [oidc.allowInsecureRequests] } : {},
    )
  }
  return cached
}

export type AuthorizationStart = {
  /** Where to send the browser (Zitadel `/oauth/v2/authorize` URL). */
  url: string
  /** OIDC `state`, must round-trip through the flow cookie. */
  state: string
  /** PKCE verifier, must round-trip through the flow cookie. */
  codeVerifier: string
}

/**
 * Builds the auth-URL the user's browser should be redirected to. Caller
 * is responsible for setting a short-lived cookie carrying `{state,
 * codeVerifier, next}` (see `OidcFlowState`).
 *
 * Scope set:
 *   - openid profile email — standard ID-token claims
 *   - offline_access       — issues refresh_token (kept on Zitadel side;
 *                            menu's session lifetime is independent)
 *   - urn:zitadel:iam:org:project:roles
 *                          — asks Zitadel to embed the user's roles for
 *                            the iedora project under the
 *                            `urn:zitadel:iam:org:project:roles` claim.
 *                            `extractZitadelProjectRoles` reads the keys.
 *                            The OIDC app's `*_role_assertion = true`
 *                            flags do the same job server-side;
 *                            requesting the scope is the explicit,
 *                            client-declared version — defence in depth
 *                            against the assertion flags ever flipping.
 */
export async function buildAuthorizationStart(redirectUri: string): Promise<AuthorizationStart> {
  const config = await getConfig()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const state = oidc.randomState()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access urn:zitadel:iam:org:project:roles',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })
  return { url: url.toString(), state, codeVerifier }
}

export type CallbackResult = {
  sub: string
  email: string
  name: string
  /**
   * Project roles literally granted by Zitadel on the iedora project.
   * Kept for audit / debug. Authorization gates use `permissions`.
   */
  roles: string[]
  /**
   * Flat scopes injected into the id_token by the Zitadel Actions v2
   * webhook at `/api/zitadel/permissions`. Single source of truth for
   * `requireScope` checks. Empty if the webhook didn't run (action
   * misconfigured, target unreachable, fresh sign-in pre-rollout).
   */
  permissions: string[]
  /** Raw access_token if the caller needs it (we don't, currently). */
  accessToken: string
  /** Token expiry — Zitadel access_token TTL. */
  accessTokenExpiresAt: number
}

/**
 * Pull project-role keys off a Zitadel id_token claims object. The claim
 * shape is `{ "<role_key>": { "<org_id>": "<org_login>" } }`; we only care
 * about the keys (the role names). Returns `[]` when the claim is absent or
 * malformed — callers treat empty as "no special permissions".
 */
export function extractZitadelProjectRoles(claims: Record<string, unknown>): string[] {
  const raw = claims['urn:zitadel:iam:org:project:roles']
  if (!raw || typeof raw !== 'object') return []
  return Object.keys(raw as Record<string, unknown>)
}

/**
 * Pull the flat `permissions` claim (string[]) injected by the Zitadel
 * Actions v2 webhook. Returns `[]` if the claim is missing or malformed
 * — callers treat empty as "user has no scopes".
 */
export function extractPermissionsClaim(claims: Record<string, unknown>): string[] {
  const raw = claims['permissions']
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is string => typeof p === 'string')
}

/**
 * Exchanges the callback URL for tokens. openid-client v6 verifies the
 * id_token signature + nonce/state internally; we just hand it the
 * `currentUrl` (Next's `req.url` already includes query string) and the
 * cookie-recovered PKCE verifier + state.
 *
 * Returns the subset of claims menu's session adapter persists. We
 * deliberately do NOT keep the refresh_token — menu's session cookie has
 * its own TTL and re-auths via a fresh OIDC dance.
 */
export async function exchangeAuthorizationCode(args: {
  currentUrl: URL
  codeVerifier: string
  expectedState: string
}): Promise<CallbackResult> {
  const config = await getConfig()
  const tokens = await oidc.authorizationCodeGrant(config, args.currentUrl, {
    pkceCodeVerifier: args.codeVerifier,
    expectedState: args.expectedState,
  })

  const claims = tokens.claims()
  if (!claims) throw new Error('OIDC: missing id_token claims')

  const sub = claims.sub
  const email = typeof claims.email === 'string' ? claims.email : ''
  const name = typeof claims.name === 'string' ? claims.name : email
  const claimMap = claims as Record<string, unknown>
  const roles = extractZitadelProjectRoles(claimMap)
  const permissions = extractPermissionsClaim(claimMap)

  const accessToken = tokens.access_token
  if (!accessToken) throw new Error('OIDC: missing access_token in response')

  // tokens.expires_in is seconds-from-now per RFC 6749.
  const ttl = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
  const accessTokenExpiresAt = Math.floor(Date.now() / 1000) + ttl

  return { sub, email, name, roles, permissions, accessToken, accessTokenExpiresAt }
}

/**
 * Build the Zitadel end-session URL for federated logout. Optional but
 * polite — when the user logs out of menu we also tell Zitadel to drop
 * its session so a subsequent visit doesn't silently re-auth.
 */
export function buildEndSessionUrl(opts: {
  postLogoutRedirectUri: string
  idTokenHint?: string
}): string {
  // openid-client v6's `buildEndSessionUrl` helper requires a Configuration.
  // We don't await here because the helper is sync-only after discovery —
  // call sites pass an already-resolved config via `getConfig()`. Instead
  // we build the URL by hand to avoid making this whole function async
  // for a simple path concat.
  const base = env.ZITADEL_ISSUER_URL.replace(/\/$/, '')
  const url = new URL(`${base}/oidc/v1/end_session`)
  url.searchParams.set('post_logout_redirect_uri', opts.postLogoutRedirectUri)
  if (opts.idTokenHint) url.searchParams.set('id_token_hint', opts.idTokenHint)
  url.searchParams.set('client_id', env.ZITADEL_OAUTH_CLIENT_ID)
  return url.toString()
}

/** Test helper — forces a fresh discovery on the next call. */
export function _resetConfigForTests(): void {
  cached = undefined
}
