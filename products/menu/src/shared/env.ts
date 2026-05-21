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
  DATABASE_URL: z.url(),

  // Auth (Zitadel native OIDC) ------------------------------------------
  // Menu's public base URL — used to build the OIDC redirect_uri and
  // post-logout URI. Must match the values declared in TF for
  // zitadel_application_oidc.menu (infra/tofu/zitadel.tf).
  MENU_PUBLIC_URL: z.url(),

  // 32-byte (or more) secret used to derive the JWE encryption key for
  // the menu session cookie (jose, alg=dir, enc=A256GCM). Minted in TF
  // by random_password.menu_session_secret. Rotating it invalidates
  // every session — see infra/tofu/zitadel.tf.
  MENU_SESSION_SECRET: z.string().min(32),

  // Zitadel issuer base URL. Discovery doc lives at
  // `${ZITADEL_ISSUER_URL}/.well-known/openid-configuration`. Production:
  // https://auth.iedora.com — dev points at a local stand-in.
  ZITADEL_ISSUER_URL: z.url(),
  ZITADEL_OAUTH_CLIENT_ID: z.string().min(1),
  ZITADEL_OAUTH_CLIENT_SECRET: z.string().min(1),

  // PAT for menu's IAM_OWNER service account. Identity slice uses this
  // bearer for org provisioning + membership lookups. Minted in TF by
  // zitadel_personal_access_token.menu_sa.
  ZITADEL_MANAGEMENT_TOKEN: z.string().min(1),

  // HMAC signing key for the Zitadel Actions v2 webhook that injects the
  // flat `permissions` claim into id_token / access_token. Minted in TF
  // by zitadel_action_target.menu_permissions (computed `signing_key`).
  // The /api/zitadel/permissions route uses it to validate the
  // `ZITADEL-Signature` header on every inbound call.
  ZITADEL_ACTION_SIGNING_KEY: z.string().min(1),

  // ID of the iedora Zitadel project. The webhook uses it as `projectId`
  // when self-healing an admin's missing iedora-admin grant on their
  // first sign-in (the TF-time grant helper can't reach a user that
  // doesn't exist yet — Zitadel only auto-provisions on first OIDC
  // login). Empty in tests / build stub.
  IEDORA_PROJECT_ID: z.string().default(''),

  // Comma-separated emails that should auto-receive `iedora-admin` on
  // first sign-in. Matches `var.iedora_admin_emails` on the TF side.
  // Webhook reads this list, grants the role inline when the user has
  // none, includes the expanded scopes in the same response — so the
  // FIRST token already carries the right permissions claim. Empty
  // disables self-heal (production behaviour falls back to the TF-side
  // null_resource grant for users that pre-existed at apply time).
  IEDORA_ADMIN_EMAILS: z.string().default(''),

  // Rate-limit kill-switch. Set 'true' in e2e tests so the slice short-circuits
  // to "always ok" and load-bearing flows (org creation, asset upload) can
  // run in tight loops. Never enable in production.
  DISABLE_RATE_LIMIT: z.enum(['true', 'false']).optional(),

  // Object storage (S3 / MinIO / LocalStack / R2) -----------------------
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
