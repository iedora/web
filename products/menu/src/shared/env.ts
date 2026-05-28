/**
 * Centralized, Zod-validated runtime environment.
 *
 * Two operating modes:
 *  - Build (`SKIP_ENV_VALIDATION=1`): returns a stub Proxy so `next build`'s
 *    "collect page data" phase can evaluate server modules (lib/db, auth,
 *    storage) without real secrets. The real environment is wired at runtime.
 *  - Runtime: parses `process.env` with Zod and crashes loud, naming the
 *    offending keys — no buried postgres-js stack traces.
 *
 * Add a new env var by extending `serverSchema` below and (if appropriate)
 * `.env.example`. Optional vars use `.optional()`; defaults use `.default(…)`.
 */
import { z } from 'zod'

const serverSchema = z.object({
  // Node ----------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database ------------------------------------------------------------
  // Postgres URL pointing at the `menu` database (this product's
  // schema). Prefixed `MENU_*` to mirror `CORE_DATABASE_URL` — every
  // product owns its own DB env var so future split (menu → own
  // deployment / microservice) is a single flip.
  MENU_DATABASE_URL: z.url(),

  // Auth (@iedora/auth — better-auth) -----------------------------------
  // Postgres URL pointing at the `core` database (better-auth tables).
  // Same Postgres instance as MENU_DATABASE_URL — different DB.
  CORE_DATABASE_URL: z.url(),
  // ≥ 32-char secret used by better-auth to sign session tokens.
  CORE_SECRET: z.string().min(32),
  // Canonical URL of the auth API — the `core` product's origin.
  // Prod: `https://core.iedora.com`. Dev: `http://localhost:3000`.
  // better-auth's baseURL points here; cookies issue from this origin
  // on the parent `.iedora.com` domain so SSO works across products.
  CORE_BASE_URL: z.url(),
  // Client-side mirror — inlined into the browser bundle by Next at
  // build time (NEXT_PUBLIC_* prefix). Includes the `/core` path
  // segment in dev (`http://localhost:3000/core`) and the bare host in
  // prod (`https://core.iedora.com`) so route construction is uniform.
  NEXT_PUBLIC_CORE_URL: z.url(),
  // Comma-separated allow-list for CSRF (browser-origin checks).
  CORE_TRUSTED_ORIGINS: z.string().default(''),
  // Parent-domain cookie scope. Production: `.iedora.com` (default).
  // Dev: `localhost`. Empty string falls back to better-auth's default.
  CORE_COOKIE_DOMAIN: z.string().default('.iedora.com'),

  // Menu's public URL — used for absolute URL construction via
  // `publicUrl()`. Must match the canonical hostname the menu serves
  // (`https://menu.iedora.com` in prod, `http://localhost:3000` in
  // dev). `NEXT_PUBLIC_` so the client bundle has it too (mirrors
  // `NEXT_PUBLIC_CORE_URL`'s shape — every product's public URL
  // follows this convention).
  NEXT_PUBLIC_MENU_URL: z.url(),

  // Rate-limit kill-switch. Set 'true' in e2e tests so the slice short-circuits
  // to "always ok" and load-bearing flows (org creation, asset upload) can
  // run in tight loops. Never enable in production.
  DISABLE_RATE_LIMIT: z.enum(['true', 'false']).optional(),

  // Object storage (S3 / R2 / s3mock) ---------------------------------
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // Optional CDN override. When unset, features/upload derives a path-style
  // URL from S3_ENDPOINT + S3_BUCKET.
  S3_PUBLIC_URL: z.url().optional(),
  // Set to 'true' for S3-compatible mocks that require path-style
  // addressing (s3mock, LocalStack). Leave unset for R2 / AWS S3.
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
})

type ServerEnv = z.infer<typeof serverSchema>

const SKIP =
  process.env.SKIP_ENV_VALIDATION === '1' ||
  process.env.SKIP_ENV_VALIDATION === 'true'

function parseEnv(): ServerEnv {
  if (SKIP) {
    // Build-time stub. Any read returns an empty string except NODE_ENV,
    // which is consulted by lib/db to decide whether to cache the
    // connection on globalThis. We pin it to 'production' during builds.
    return new Proxy({} as ServerEnv, {
      get(_target, key) {
        if (key === 'NODE_ENV') return 'production'
        return ''
      },
    })
  }

  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Invalid environment variables:')
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    throw new Error('Environment validation failed')
  }
  return parsed.data
}

export const env: ServerEnv = parseEnv()
