import { relations } from 'drizzle-orm'
import {
  pgSchema,
  primaryKey,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import type { LanguageCode, LocalizedText } from '../../features/i18n/types'

// Single Postgres schema for the menu product: `menu.*`. Identity +
// tenancy + billing live in the `core` schema (managed by @iedora/core-auth
// and @iedora/core-billing) on the SAME Postgres instance but a separate
// schema — there's no FK from `menu.*` to `core.*` because the two
// schemas are owned by different products and migrated independently
// (microservices-ready: each could move to its own DB tomorrow).
//
// `tenantId` columns mirror `core.tenant.id`. Plan info lives in
// `core.tenant_subscription` (one row per (tenant, product='menu'));
// invoice ledger lives in `core.invoice` filtered by `product='menu'`.
// Both queried via `@iedora/core-billing` helpers.
export const menuSchema = pgSchema('menu')

// One row per AI menu-import generation. Weekly quota is enforced by
// the plans slice: a count of rows for `(tenantId, createdAt > now -
// 7d)` against the plan's `aiMenuGenerationsPerWeek` limit. The
// tenant id mirrors `core.tenant.id`; no FK across schemas.
export const aiMenuGeneration = menuSchema.table(
  'ai_menu_generation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Window query: COUNT(*) WHERE tenant = $1 AND created_at > now() - '7d'.
    index('ai_menu_generation_tenant_time_idx').on(t.tenantId, t.createdAt),
  ],
)

// ─── Domain: restaurant menu builder ──────────────────────────────────────────

/**
 * Ad-hoc price variant on an `item`. `label` is operator-authored copy
 * shown to guests next to the price (e.g. "Meia dose", "Imperial",
 * "Jarra 0.5L"). `priceCents` is integer cents, same money rule as the
 * primary `priceCents` column. Items normally have no variants
 * (primary price only); ones that do typically carry 1–2.
 *
 * `labelI18n` mirrors the per-table `*I18n` pattern: `label` carries the
 * source/default-language copy; `labelI18n` carries translations into
 * non-default languages. Optional + nullable so untranslated variants
 * stay compact in the jsonb. Renderer follows the standard fallback
 * chain (requested → default `label` → empty) via `localized()`.
 */
export type ItemVariant = {
  label: string
  labelI18n?: LocalizedText | null
  priceCents: number
}

export type RestaurantTheme = {
  primaryColor?: string
  secondaryColor?: string
  font?: 'inter' | 'playfair' | 'lora' | 'space-grotesk'
  layout?: 'classic' | 'minimal'
  // forward-compatible — extend without migrations
  [key: string]: unknown
}

export const restaurant = menuSchema.table(
  'restaurant',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Iedora tenant id (mirrors `core.tenant.id`). No FK because the
    // column lives in a different schema/product; tenancy is enforced
    // at the DAL via `requireRestaurantAccess` (`@/features/auth`)
    // which checks `tenant_member.scopes` for the active tenant.
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    descriptionI18n: jsonb('description_i18n').$type<LocalizedText>(),
    logoUrl: text('logo_url'),
    bannerUrl: text('banner_url'),
    theme: jsonb('theme').$type<RestaurantTheme>(),
    // i18n config — defaultLanguage names which language the row's plain text
    // columns are written in; supportedLanguages lists every language the
    // public menu offers. Adding a new language = entry in lib/i18n/registry +
    // checkbox saves into supportedLanguages here.
    defaultLanguage: text('default_language').$type<LanguageCode>().notNull().default('en'),
    supportedLanguages: jsonb('supported_languages')
      .$type<LanguageCode[]>()
      .notNull()
      .default(['en']),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    /**
     * When the post-create wizard (`/menu/onboarding/menu/[slug]`)
     * was either completed or explicitly skipped. NULL = the
     * restaurant is still mid-onboarding; `/menu/onboarding` will
     * redirect the operator back into the wizard instead of letting
     * them start a brand-new restaurant from step 1 (which would
     * create a duplicate row on submit). Existing rows are
     * backfilled to `created_at` by the migration so legacy
     * restaurants don't bounce anyone into the wizard.
     */
    onboardingCompletedAt: timestamp('onboarding_completed_at'),
  },
  (t) => [index('restaurant_tenant_idx').on(t.tenantId)],
)

export const menu = menuSchema.table(
  'menu',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameI18n: jsonb('name_i18n').$type<LocalizedText>(),
    description: text('description'),
    descriptionI18n: jsonb('description_i18n').$type<LocalizedText>(),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('menu_restaurant_idx').on(t.restaurantId)],
)

export const category = menuSchema.table(
  'category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    menuId: text('menu_id')
      .notNull()
      .references(() => menu.id, { onDelete: 'cascade' }),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameI18n: jsonb('name_i18n').$type<LocalizedText>(),
    description: text('description'),
    descriptionI18n: jsonb('description_i18n').$type<LocalizedText>(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    /**
     * When the i18n overrides on this row were last machine-translated.
     * NULL = never synced. Compared against `updated_at` to find stale
     * rows during a "Refresh translations" pass: stale iff
     * `updated_at > translations_synced_at` (or the timestamp is NULL).
     */
    translationsSyncedAt: timestamp('translations_synced_at'),
  },
  (t) => [
    index('category_menu_idx').on(t.menuId),
    index('category_restaurant_idx').on(t.restaurantId),
  ],
)

export const item = menuSchema.table(
  'item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryId: text('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Translation overrides for non-default languages. Default language is
    // always read from `name` / `description`. See lib/i18n/format.ts.
    nameI18n: jsonb('name_i18n').$type<LocalizedText>(),
    description: text('description'),
    descriptionI18n: jsonb('description_i18n').$type<LocalizedText>(),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    imageUrl: text('image_url'),
    position: integer('position').notNull().default(0),
    available: boolean('available').notNull().default(true),
    tags: jsonb('tags').$type<string[]>().default([]),
    // Ad-hoc price variants — "Dose / Meia dose", "Imperial / Caneca",
    // "Jarra 0.5L / 1L". `priceCents` (above) is the primary/leftmost
    // price; this array carries every alternate as a labelled price.
    // Null when the item has a single price (the common case). Order is
    // preserved so the public menu renders variants in menu-card order.
    variants: jsonb('variants').$type<ItemVariant[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // See `category.translationsSyncedAt` — same staleness semantics.
    translationsSyncedAt: timestamp('translations_synced_at'),
  },
  (t) => [
    index('item_category_idx').on(t.categoryId),
    index('item_restaurant_idx').on(t.restaurantId),
  ],
)

// ─── Metrics ──────────────────────────────────────────────────────────────────

/**
 * Per-visitor dedup ledger. Composite PK on (visitor, restaurant, hour) lets
 * the track endpoint do an idempotent `INSERT … ON CONFLICT DO NOTHING`: when
 * a row is created, count the view; when it already exists, no-op. Cleared
 * periodically (vacuum/purge older than 24h) — only the current bucket needs
 * to be in the index for the gate to work.
 *
 * `hour_bucket` is `YYYY-MM-DD-HH` (UTC). Plain text so the PK comparison is
 * lex-equality and we don't bind ourselves to a timezone-shifted date type.
 */
export const viewSeen = menuSchema.table(
  'view_seen',
  {
    visitorId: text('visitor_id').notNull(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurant.id, { onDelete: 'cascade' }),
    hourBucket: text('hour_bucket').notNull(),
    seenAt: timestamp('seen_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.visitorId, t.restaurantId, t.hourBucket] }),
    index('view_seen_seen_at_idx').on(t.seenAt),
  ],
)

/**
 * Per-day, per-language page-view counter for the public menu. The composite
 * PK lets us upsert in one round-trip; org id is denormalized so the dashboard
 * roll-ups (today / last 7 days / last 30 days, current month for the meter)
 * stay a single indexed scan instead of joining through restaurant.
 *
 * `day` is `YYYY-MM-DD` text so range queries are plain lex comparisons —
 * keeps the schema portable and timezone-explicit (we always store UTC days).
 * `language` lets the Casa "reading the menu in" card group without a second
 * table.
 */
export const dailyView = menuSchema.table(
  'daily_view',
  {
    // Iedora tenant id (mirrors `core.tenant.id`); no FK across schemas.
    tenantId: text('tenant_id').notNull(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurant.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    language: text('language').$type<LanguageCode>().notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.restaurantId, t.day, t.language] }),
    index('daily_view_tenant_day_idx').on(t.tenantId, t.day),
  ],
)

// ─── Billing tables removed ──────────────────────────────────────────
// `org_plan` + `invoice` lived here in the better-auth-organization era.
// Both moved to `core` (managed by @iedora/core-billing) so plans + invoices
// are uniform across products. Menu callers reach for the cross-product
// helpers:
//   - getSubscription(tenantId, PRODUCTS.menu)   → tenant_subscription row
//   - listTenantInvoices(tenantId, {product: PRODUCTS.menu}) → invoices
// The plan REGISTRY (free / casa with limits) stays under
// `products/menu/src/features/plans/` — menu still owns "what does a
// menu plan mean", core just owns the subscription row.

// ─── QR codes ─────────────────────────────────────────────────────────────────
// Physical-sticker registry. Each `code` is a short token printed on a sticker
// (`menu.iedora.com/q/<code>`). An unbound row exists for "I printed it, haven't
// decided which restaurant yet"; admin (iedora-admin role) binds it later by
// setting `restaurantId`. `onDelete: 'set null'` keeps the sticker valid if a
// restaurant is later deleted — the code can be rebound rather than discarded.
//
// CRUD is Iedora-staff only (see `requireScope`); tenant scoping does
// NOT apply here — this is a cross-tenant operational table.

export const qrCode = menuSchema.table(
  'qr_code',
  {
    code: text('code').primaryKey(),
    restaurantId: text('restaurant_id').references(() => restaurant.id, {
      onDelete: 'set null',
    }),
    // Optional free-text label the admin uses to track stickers in the
    // physical world ("box A — May 2026", "table 12"). Not exposed publicly.
    label: text('label'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Set when restaurantId moves from null → non-null; cleared on unbind.
    boundAt: timestamp('bound_at'),
  },
  (t) => [index('qr_code_restaurant_idx').on(t.restaurantId)],
)

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// Append-only log of rate-limit attempts. Sliding window is computed on read
// (DELETE-expired → INSERT-now → COUNT, all in one transaction guarded by an
// advisory lock keyed on the rate-limit key). Same shape as the Redis ZSET
// adapter that lived here previously — one row per attempt, periodic pruning
// keeps the table small. Composite index supports both the lookup pattern
// and the cleanup DELETE.

export const rateLimitEvent = menuSchema.table(
  'rate_limit_event',
  {
    key: text('key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('rate_limit_event_key_time_idx').on(t.key, t.occurredAt)],
)

// ─── Relations ────────────────────────────────────────────────────────────────

export const restaurantRelations = relations(restaurant, ({ many }) => ({
  menus: many(menu),
}))

export const menuRelations = relations(menu, ({ one, many }) => ({
  restaurant: one(restaurant, {
    fields: [menu.restaurantId],
    references: [restaurant.id],
  }),
  categories: many(category),
}))

export const categoryRelations = relations(category, ({ one, many }) => ({
  menu: one(menu, { fields: [category.menuId], references: [menu.id] }),
  restaurant: one(restaurant, {
    fields: [category.restaurantId],
    references: [restaurant.id],
  }),
  items: many(item),
}))

export const itemRelations = relations(item, ({ one }) => ({
  category: one(category, {
    fields: [item.categoryId],
    references: [category.id],
  }),
  restaurant: one(restaurant, {
    fields: [item.restaurantId],
    references: [restaurant.id],
  }),
}))
