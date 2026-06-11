/**
 * Centralized, Zod-validated runtime environment.
 *
 * Post Go-backend migration the menu product holds NO infrastructure
 * config — databases, S3, auth secrets and rate limits all live with
 * the Go services (see services/). What's left is the product's own
 * public origin, used for absolute URL construction.
 *
 * Two operating modes:
 *  - Build (`SKIP_ENV_VALIDATION=1`): returns a stub Proxy so `next build`'s
 *    "collect page data" phase can evaluate server modules without real
 *    values. The real environment is wired at runtime.
 *  - Runtime: parses `process.env` with Zod and crashes loud, naming the
 *    offending keys.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Menu's public URL — used for absolute URL construction via
  // `publicUrl()`. Must match the canonical hostname the menu serves
  // (`https://menu.iedora.com` in prod, `http://localhost:3000` in
  // dev). `NEXT_PUBLIC_` so the client bundle has it too (mirrors
  // `NEXT_PUBLIC_CORE_URL`'s shape — every product's public URL
  // follows this convention).
  NEXT_PUBLIC_MENU_URL: z.url(),
})

type ServerEnv = z.infer<typeof serverSchema>

const SKIP =
  process.env.SKIP_ENV_VALIDATION === '1' ||
  process.env.SKIP_ENV_VALIDATION === 'true'

/**
 * Resolve the Docker/Swarm secrets `*_FILE` convention: for any `FOO_FILE`
 * env var, read the file and expose its trimmed contents as `FOO`. Lets the
 * orchestrator mount secrets as files (tmpfs, out of `docker inspect` / the
 * service spec / the Raft log) instead of plain env.
 *
 * The file WINS: it overwrites any value already on `FOO`. That existing value
 * is almost always a baked dev default — the tracked `apps/web/.env` (which
 * ships in the image and Next loads into `process.env` at runtime) sets
 * CORE_SECRET / *_DATABASE_URL. The mounted secret is the real production value
 * and must take precedence, so we don't error on "both set".
 *
 * Mutates `process.env` in place (like an entrypoint `export FOO=$(cat …)`
 * would) so code that reads `process.env.FOO` directly — not just this schema —
 * sees the resolved value too.
 */
function resolveSecretFiles(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.endsWith('_FILE') || !value) continue
    const base = key.slice(0, -'_FILE'.length)
    process.env[base] = readFileSync(value, 'utf8').trim()
  }
}

function parseEnv(): ServerEnv {
  if (SKIP) {
    // Build-time stub. Any read returns an empty string except NODE_ENV,
    // which we pin to 'production' during builds.
    return new Proxy({} as ServerEnv, {
      get(_target, key) {
        if (key === 'NODE_ENV') return 'production'
        return ''
      },
    })
  }

  resolveSecretFiles()
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
