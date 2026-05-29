import {
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgSchema,
} from 'drizzle-orm/pg-core'

import type { Scope } from './scopes'

// Billing tables live in the same `core` schema but are owned by
// `@iedora/core-billing`. Re-export them here so drizzle-kit's single
// schema scan (config in `drizzle.config.ts` points at this file)
// picks up the full set of `core.*` tables and generates one
// migration set covering both. Helpers + audit hooks for the
// billing tables live in the billing package, not here.
import {
  tenantSubscription,
  invoice,
} from '@iedora/core-billing/schema'
export { tenantSubscription, invoice }

// `tenant_product_state` lives in `@iedora/core-tenancy` (cross-product
// projection table). Re-exported here for the same reason: single
// migration generator, single schema graph for the `core` DB.
import { tenantProductState } from '@iedora/core-tenancy/schema'
export { tenantProductState }

/**
 * Drizzle schema for the iedora auth surface.
 *
 * Lives in the `core` Postgres database, under the `core` schema, on the
 * SHARED Postgres instance. `core` is the namespace owned by the (future)
 * core product — auth tables today, audit + admin tables tomorrow.
 *
 * Tables match the shape better-auth expects (the library generates SQL
 * with these exact column names when you run its CLI; we maintain the
 * schema by hand here so we own migrations and the type surface stays
 * in one place).
 *
 * Tables:
 *   - `user`           — identity row. `role` is the cross-tenant scalar
 *                         (null for tenants, `iedora-admin` for staff).
 *   - `session`        — opaque token + activeTenantId pointer.
 *   - `account`        — provider linkage. With email+password only, a
 *                         row per user with `providerId='credential'`.
 *   - `verification`   — short-lived OTPs / email-change tokens.
 *   - `tenant`         — the tenancy entity owned cross-product. Replaces
 *                         better-auth's `organization` table; products
 *                         reference it via a soft-FK `tenantId` string
 *                         in their own schemas (no real FK across DBs,
 *                         microservices-ready).
 *   - `tenant_member`  — (user, tenant, scopes[]) join. Scopes are the
 *                         authoritative permission list — roles like
 *                         "owner" / "viewer" exist only as UI presets
 *                         that expand to a scope array on the way in.
 *
 * All columns use snake_case at the database layer (Drizzle's
 * `casing: 'snake_case'` config in `drizzle.config.ts`).
 */

export const coreSchema = pgSchema('core')

export const user = coreSchema.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /**
   * Cross-tenant authority — the explicit scope set granted to this
   * user. `null` for regular tenants (their authority lives in
   * `tenant_member.scopes`, scoped to each tenant). Non-null for
   * staff: the array IS the source of truth; preset labels like
   * `'iedora-admin'` are detected by `detectStaffPreset(scopes)`
   * in `./role-presets` for UI display only.
   */
  scopes: text('scopes').array().$type<Scope[]>(),
  /** Flag flipped by `banUser()` (formerly better-auth admin plugin). */
  banned: boolean('banned'),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const session = coreSchema.table('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /**
   * Points at the tenant the user is currently acting on. Authorisation
   * checks resolve scope inclusion against the matching `tenant_member`
   * row. Lazy-revalidated on read: a stale id (member removed) returns
   * `null` from `getActiveTenantId()` and the caller redirects to the
   * picker / onboarding.
   */
  activeTenantId: text('active_tenant_id'),
  /** Set by `admin` plugin during impersonation. */
  impersonatedBy: text('impersonated_by'),
})

export const account = coreSchema.table('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = coreSchema.table('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

/**
 * The tenancy entity — owned cross-product. Replaces better-auth's
 * `organization`. Other products reference it via a soft-FK `tenantId`
 * string column in their own DBs; no FK constraint is ever declared
 * across product DBs (microservices-ready).
 *
 * Slug intentionally omitted today — menu's public URLs are restaurant-
 * scoped (`/menu/r/<restaurant-slug>`), not tenant-scoped, so tenants
 * stay invisible to end users. Add a `slug` column if/when a use case
 * demands tenant-scoped URLs.
 */
export const tenant = coreSchema.table('tenant', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * Tenant membership — (user, tenant) pair carrying the user's authority
 * inside that tenant as an explicit array of scope strings.
 *
 * Why scopes (and not a role string): roles are UX presets, not data.
 * `TENANT_ROLE_PRESETS` in `./role-presets.ts` expand a label like
 * `'owner'` / `'viewer'` to its scope array on the way in; on the way
 * out, the same module's `detectPreset()` can reverse-map for display.
 * Persisting only the scopes means a renamed/removed preset doesn't
 * silently re-permission a member, AND custom multi-select grants
 * (e.g. Mario-can-only-publish-to-idealista) cost zero new schema.
 *
 * GIN index on `scopes` will be added in a follow-up migration once
 * we have query patterns that warrant it (`scopes @> ARRAY[...]`).
 */
export const tenantMember = coreSchema.table(
  'tenant_member',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().$type<Scope[]>().notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_member_tenant_user_uniq').on(t.tenantId, t.userId),
    index('tenant_member_user_idx').on(t.userId),
    index('tenant_member_tenant_idx').on(t.tenantId),
  ],
)

/**
 * Rate-limit table. Used by better-auth's built-in rate limiter when
 * `storage: 'database'` is configured — survives process restarts and
 * works across multiple Next.js instances behind the same Postgres.
 */
export const rateLimit = coreSchema.table('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key'),
  count: integer('count'),
  lastRequest: timestamp('last_request'),
})

/**
 * Audit log — every state-changing event on the auth + admin surface.
 *
 * Append-only by design. No row is ever updated or deleted by app code;
 * a future vacuum-job may purge old rows under a retention policy, but
 * day 0 there's no TTL — events live forever.
 *
 * `actor_*` columns are denormalized snapshots taken at the moment of
 * the event — the user row may be banned/renamed later, but the audit
 * trail remembers what was true when the action happened. Same for
 * `target_*`.
 *
 * `event` is the namespaced event key (see `audit.ts` for the registry).
 * Examples: `user.signed-up`, `user.banned`, `member.removed`,
 * `auth.denied`. New event types are free strings — no enum.
 *
 * `outcome` is one of:
 *   - `success` — action completed
 *   - `denied`  — caller authenticated but lacked the required scope
 *   - `error`   — action threw at the gateway layer (audit fires anyway)
 *
 * `meta` is a free-form JSON blob — ban reason, role granted, scope
 * attempted, etc. Search via `WHERE meta->>'key' = ...` when needed.
 *
 * Indexes are tuned for the four read paths the admin UI uses:
 * timeline (at DESC), per-actor history, per-target history (by user
 * AND by org separately), and per-event-type filter.
 */
export const auditLog = coreSchema.table(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),

    // Actor — snapshot of who did the thing.
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    actorEmail: text('actor_email'),

    // Event taxonomy.
    event: text('event').notNull(),
    outcome: text('outcome').notNull(),

    // Target(s) — populated when the event has one. Multiple may be
    // set (e.g. session.revoked has target_user_id + target_session_id).
    targetUserId: text('target_user_id'),
    targetTenantId: text('target_tenant_id'),
    targetSessionId: text('target_session_id'),

    // Caller context. `ipHash` is SHA-256 of the IP, hex — keeps the
    // audit trail useful for "same actor came back" without retaining
    // raw PII at rest.
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    requestPath: text('request_path'),

    // Free-form details. Examples: { reason, banExpiresIn, role,
    // scope, attemptedPath, previousRole, organizationId }.
    meta: jsonb('meta'),

    // Filter toggle for the timeline UI — `false` for high-volume
    // routine events (page views), `true` for state changes worth
    // highlighting (bans, role changes, impersonations).
    important: boolean('important').notNull().default(false),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_actor_idx').on(t.actorUserId, t.at),
    index('audit_log_target_user_idx').on(t.targetUserId, t.at),
    index('audit_log_target_tenant_idx').on(t.targetTenantId, t.at),
    index('audit_log_event_idx').on(t.event, t.at),
  ],
)

export const schema = {
  user,
  session,
  account,
  verification,
  tenant,
  tenantMember,
  tenantSubscription,
  invoice,
  tenantProductState,
  rateLimit,
  auditLog,
}
