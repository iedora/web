/**
 * Centralized, Zod-validated runtime environment.
 *
 * Two operating modes:
 *  - Build (`SKIP_ENV_VALIDATION=1`): returns a stub Proxy so `next build`'s
 *    "collect page data" phase can evaluate server modules (lib/db, auth,
 *    storage) without real secrets. Kamal injects the real env at runtime.
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
  // Better Auth signs sessions with this; must be ≥32 chars of entropy.
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  // Optional knob consumed by lib/auth.ts. Tests set it to disable the
  // in-memory rate limiter so the E2E suite can create users in a loop.
  DISABLE_AUTH_RATE_LIMIT: z.enum(['true', 'false']).optional(),

  // Cache / queue -------------------------------------------------------
  // Optional — no runtime client wired yet (we have docker-compose redis
  // ready for when rate-limiting or job queues land). Mark required when
  // first consumer ships.
  REDIS_URL: z.url().optional(),

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
