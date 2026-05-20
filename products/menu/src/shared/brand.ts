/**
 * Single source of truth for brand + public URLs that appear in the UI.
 *
 * Static / safe in both server and client components (no `@/shared/env`
 * import) — for RUNTIME urls (CORS origin, auth callbacks, etc.) read
 * `env.BETTER_AUTH_URL` from `@/shared/env` instead. The two stay in sync
 * because `BETTER_AUTH_URL` is wired to `https://${APP_HOSTNAME}` in
 * `infra/tofu/containers.tf` (docker_container.menu_web env).
 *
 * To rebrand: change `BRAND_DOMAIN`. Everything else derives from it.
 */
export const BRAND_DOMAIN = 'iedora.com'

export const BRAND_NAME = 'iedora'
export const BRAND_URL = `https://${BRAND_DOMAIN}`
export const CONTACT_EMAIL = `hello@${BRAND_DOMAIN}`

// The Menu app lives on a `menu.` subdomain of the brand.
export const APP_HOSTNAME = `menu.${BRAND_DOMAIN}`
export const APP_URL = `https://${APP_HOSTNAME}`

// Genkan — Iedora's identity service. Owns users, organizations, OAuth
// clients, grants. Every product (menu, future .NET APIs, …) plugs in via
// standard OIDC. In dev: localhost:3001 (menu = :3000, genkan = :3001).
export const GENKAN_HOSTNAME = `genkan.${BRAND_DOMAIN}`

// Resolution order (so e2e tests can swap to a fixture without touching code):
//   1. NEXT_PUBLIC_GENKAN_URL — explicit override. Inlined at build time for
//      client components, available at runtime on the server. Set this to
//      the auth-testkit's URL in e2e fixtures.
//   2. NODE_ENV defaults — https://genkan.iedora.com in prod, localhost:3001
//      in dev.
//
// The `env.GENKAN_ISSUER_URL` env var (read by server-only Better Auth
// config) MUST agree with this for in-browser CTA hrefs and the OAuth
// discovery URL to point at the same instance.
export const GENKAN_URL =
  process.env.NEXT_PUBLIC_GENKAN_URL ??
  (process.env.NODE_ENV === 'production'
    ? `https://${GENKAN_HOSTNAME}`
    : 'http://localhost:3001')
