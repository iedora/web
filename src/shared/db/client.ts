import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/shared/env'
import * as schema from './schema'

/**
 * T3-style globalThis singleton for the postgres-js client.
 *
 * Why: in dev, Next 16 HMR re-evaluates server modules on every code change,
 * which would create a new pool on each reload and eventually exhaust
 * Postgres connections. Caching on `globalThis` makes the client survive
 * module reloads in dev; in production each worker still gets exactly one
 * pool (no global cache needed).
 */
type DbClient = ReturnType<typeof postgres>

const globalForDb = globalThis as unknown as {
  conn?: DbClient
}

const conn: DbClient =
  globalForDb.conn ??
  postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false,
  })

if (env.NODE_ENV !== 'production') {
  globalForDb.conn = conn
}

export const db = drizzle(conn, { schema, casing: 'snake_case' })
export type DB = typeof db

/**
 * Graceful pool drain. Called from `instrumentation.ts` on SIGTERM/SIGINT
 * (Kamal rolling deploys). `timeout` is seconds, matching postgres-js's
 * `sql.end({ timeout })` semantics — pending queries get that long to
 * finish before sockets are closed.
 */
export async function closeDb(opts: { timeout?: number } = {}): Promise<void> {
  await conn.end({ timeout: opts.timeout ?? 5 })
  if (globalForDb.conn === conn) {
    globalForDb.conn = undefined
  }
}
