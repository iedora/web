import 'server-only'
import { randomUUID } from 'node:crypto'
import { desc, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { generateExportedKeyPair } from 'better-auth/plugins/jwt'
import { symmetricEncrypt } from 'better-auth/crypto'
import { jwks } from '@/shared/db/schema'
import { db } from '@/shared/db/client'
import { env } from '@/shared/env'

/**
 * Rotation use-case for the Better Auth JWKS.
 *
 * Better Auth's `jwt` plugin picks the signing key from the `jwks` table by
 * MAX(`createdAt`) — see `node_modules/better-auth/dist/plugins/jwt/adapter.mjs`'s
 * `getLatestKey`. So "rotating" is just inserting a new row with a fresh
 * key pair; the next `signJWT` call automatically switches to it.
 *
 * Old rows stay put. The plugin's `/jwks` endpoint publishes every row whose
 * `expiresAt + gracePeriod > now` (gracePeriod default 30 days). With
 * `expiresAt = null` on every row Better Auth currently writes, rows are
 * effectively retained forever — meaning any previously-signed token can
 * still be validated against its `kid`. That's fine for an IdP whose
 * longest token TTL is well under any cleanup window we'd ever set.
 *
 * Why we don't call Better Auth's `createJwk` directly:
 *   1. It's not exported as a public API method on `auth.api.*` — it's an
 *      internal function that needs a `GenericEndpointContext` (with the
 *      adapter + secret_config wired in). We'd have to fake that ctx.
 *   2. The row shape is tiny + stable. Re-creating it inline (key pair via
 *      the plugin's own helper + AES-GCM encrypt via the plugin's own
 *      crypto module) keeps the result byte-identical to what the plugin
 *      would have written, without depending on an internal-context shape
 *      that might change shape between minor versions.
 *
 * Concurrency: takes `pg_advisory_xact_lock(JWKS_ROTATION_LOCK_KEY)` so
 * parallel callers (multi-replica future, manual button while cron fires)
 * serialise. Released automatically on COMMIT/ROLLBACK.
 */

/**
 * Postgres advisory-lock key for JWKS rotation. CRC32 of the ASCII string
 * "jwks_rotation" (computed via `zlib.crc32(Buffer.from('jwks_rotation'))`).
 * Same approach as `AUDIT_CHAIN_LOCK_KEY` in `features/audit/chain.ts` —
 * stable 32-bit value baked in so a refactor of the key name is an obvious
 * diff.
 *
 * Verified: `node -e "console.log(require('zlib').crc32(Buffer.from('jwks_rotation')))"`
 * → 3828642905.
 */
export const JWKS_ROTATION_LOCK_KEY = 3828642905

/** Default cadence — matches the SOC 2-flavoured 90-day rotation policy. */
export const DEFAULT_MIN_ROTATION_INTERVAL_DAYS = 90

export type RotationResult =
  | { ok: true; rotated: true; newKeyId: string }
  | { ok: true; rotated: false; reason: 'recent'; lastRotatedAt: Date }
  | { ok: false; error: string }

/** Drizzle's PG-flavoured DB type (postgres-js OR pglite). */
type AnyPgDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

/** Minimal env surface — split out so tests can pass a fake secret. */
export interface RotateJwksDeps {
  database?: AnyPgDb
  /**
   * Secret used to AES-GCM-encrypt the private key at rest. Must match what
   * Better Auth uses to read it back (`BETTER_AUTH_SECRET`). Tests can pass
   * any 32+-char string.
   */
  secret?: string
}

export interface RotateJwksOptions {
  /** Skip the rotation if the latest row is younger than this. Default 90d. */
  minIntervalDays?: number
  /** Bypass the recency check — admin "rotate now" trigger. */
  force?: boolean
}

/**
 * Rotate the JWKS active signing key. Idempotent: if a key was rotated
 * within `minIntervalDays` and `force` is not set, returns
 * `{ ok: true, rotated: false, reason: 'recent' }` without inserting.
 *
 * Old keys are retained — Better Auth's `/jwks` endpoint will continue to
 * publish them so existing tokens validate against their `kid`.
 */
export async function rotateJwks(
  options?: RotateJwksOptions,
  deps?: RotateJwksDeps,
): Promise<RotationResult> {
  const database = deps?.database ?? (db as AnyPgDb)
  const secret = deps?.secret ?? env.BETTER_AUTH_SECRET
  const minIntervalDays =
    options?.minIntervalDays ?? DEFAULT_MIN_ROTATION_INTERVAL_DAYS
  const force = options?.force === true

  try {
    return await database.transaction(async (tx) => {
      // Serialise concurrent rotators; auto-released on commit/rollback.
      await tx.execute(
        sql`select pg_advisory_xact_lock(${JWKS_ROTATION_LOCK_KEY})`,
      )

      const latest = await tx
        .select({ id: jwks.id, createdAt: jwks.createdAt })
        .from(jwks)
        .orderBy(desc(jwks.createdAt))
        .limit(1)

      const last = latest[0]
      if (!force && last) {
        const ageMs = Date.now() - last.createdAt.getTime()
        const minMs = minIntervalDays * 24 * 60 * 60 * 1000
        if (ageMs < minMs) {
          return {
            ok: true as const,
            rotated: false as const,
            reason: 'recent' as const,
            lastRotatedAt: last.createdAt,
          }
        }
      }

      // Generate a fresh key pair using Better Auth's own helper so the
      // alg/crv match whatever the plugin would choose by default (EdDSA /
      // Ed25519 in 1.6.11; future upgrades inherit automatically).
      const { publicWebKey, privateWebKey } = await generateExportedKeyPair()
      const privateKeyJson = JSON.stringify(privateWebKey)
      const encryptedPrivate = await symmetricEncrypt({
        key: secret,
        data: privateKeyJson,
      })

      const newKeyId = randomUUID()
      await tx.insert(jwks).values({
        id: newKeyId,
        publicKey: JSON.stringify(publicWebKey),
        // Better Auth stores the encrypted blob JSON-stringified — matches
        // what `symmetricDecrypt` expects at read time (`JSON.parse(...)`).
        privateKey: JSON.stringify(encryptedPrivate),
        createdAt: new Date(),
        // expiresAt left NULL so the row is retained indefinitely in the
        // public JWKS — any token signed by this key remains verifiable
        // until we explicitly delete the row. See module-level doc.
        expiresAt: null,
      })

      return {
        ok: true as const,
        rotated: true as const,
        newKeyId,
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

/**
 * Read the latest key's id + createdAt. Used by the admin UI to show
 * "current key" + "last rotated" without exposing private material.
 */
export async function getLatestJwksKeyInfo(
  deps?: RotateJwksDeps,
): Promise<{ id: string; createdAt: Date } | null> {
  const database = deps?.database ?? (db as AnyPgDb)
  const rows = await database
    .select({ id: jwks.id, createdAt: jwks.createdAt })
    .from(jwks)
    .orderBy(desc(jwks.createdAt))
    .limit(1)
  return rows[0] ?? null
}
