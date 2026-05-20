/**
 * Centralized, Zod-validated runtime environment.
 *
 * Two operating modes:
 *  - Build (`SKIP_ENV_VALIDATION=1`): returns a stub Proxy so `next build`'s
 *    "collect page data" phase can evaluate server modules (lib/db, auth,
 *    storage) without real secrets. Tofu wires the real env at runtime
 *    (docker_container.menu_web in infra/tofu/containers.tf).
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
  // Required at runtime — every request path that hits Drizzle needs it.
  DATABASE_URL: z.url(),

  // Auth ----------------------------------------------------------------
  // Better Auth signs LOCAL sessions on menu.iedora.com with this. NOT
  // shared with Genkan — menu is a pure OAuth client of genkan now, so
  // each app signs its own session cookie on its own host.
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  // Genkan OAuth client credentials. Issued by genkan when menu was
  // registered as an OIDC client. Required in production. The discovery
  // URL (`${GENKAN_ISSUER_URL}/.well-known/openid-configuration`) is
  // resolved by Better Auth's `generic-oauth` plugin at request time —
  // we only configure the issuer + client id/secret.
  GENKAN_OAUTH_CLIENT_ID: z.string().min(1),
  GENKAN_OAUTH_CLIENT_SECRET: z.string().min(1),
  // Issuer base URL. `https://genkan.iedora.com` in prod,
  // `http://localhost:3001` in dev. The OIDC discovery + organization API
  // endpoints are derived from this.
  GENKAN_ISSUER_URL: z.url(),

  // Optional knob consumed by lib/auth.ts. Tests set it to disable the
  // in-memory rate limiter so the E2E suite can create users in a loop.
  DISABLE_AUTH_RATE_LIMIT: z.enum(['true', 'false']).optional(),

  // Rate-limit kill-switch. Set 'true' in e2e tests so the slice short-circuits
  // to "always ok" and load-bearing flows (org creation, asset upload) can
  // run in tight loops. Never enable in production. Mirrors the equivalent
  // DISABLE_AUTH_RATE_LIMIT toggle for Better Auth's own throttle.
  DISABLE_RATE_LIMIT: z.enum(['true', 'false']).optional(),

  // Object storage (S3 / MinIO / LocalStack / R2) -----------------------
  // All required — every uploaded asset path goes through getStorage().
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // Optional CDN override. When unset, features/upload derives a path-style
  // URL from S3_ENDPOINT + S3_BUCKET (MinIO/LocalStack default).
  S3_PUBLIC_URL: z.url().optional(),
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
