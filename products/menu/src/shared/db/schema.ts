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
import type { LanguageCode, LocalizedText } from '@/features/i18n/types'
import type { PlanCode } from '@/features/plans/types'

// Single Postgres schema for the menu product: `menu.*`. Zitadel owns its
// own database — menu has ZERO local identity state. The user/session/
// account/verification tables Better Auth used were dropped in #20; menu
// now mints its own session JWE (jose / random_password.menu_session_secret)
// and reads user claims off the Zitadel-issued id_token.
export const menuSchema = pgSchema('menu')

// ─── Org plan (menu-owned billing metadata, keyed by Zitadel orgId) ──────────
// Zitadel owns the organization record. The plan / tier is a menu-domain
// concern (it gates restaurant counts, monthly views, etc.) so it lives here.
// `organizationId` is a UUID handed back by Zitadel's create-org API; no FK
// — Zitadel is a separate database.
export const orgPlan = menuSchema.table('org_plan', {
  organizationId: text('organization_id').primaryKey(),
  plan: text('plan').$type<PlanCode>().notNull().default('free'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

// ─── Domain: restaurant menu builder ──────────────────────────────────────────

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
    // Zitadel-issued organization UUID. No FK — Zitadel lives in a separate
    // database. Tenancy is enforced at the DAL via the identity slice
    // (`requireRestaurantAccess` calls `listOrganizations` against Zitadel).
    organizationId: text('organization_id').notNull(),
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
  },
  (t) => [index('restaurant_org_idx').on(t.organizationId)],
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
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
    // Zitadel-issued org UUID. No FK — Zitadel is a separate database.
    organizationId: text('organization_id').notNull(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurant.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    language: text('language').$type<LanguageCode>().notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.restaurantId, t.day, t.language] }),
    index('daily_view_org_day_idx').on(t.organizationId, t.day),
  ],
)

// ─── Billing ──────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'paid' | 'pending' | 'void'

/**
 * One billing line per period, scoped to the organization. We persist the
 * plan code at the time of issuance so a rename or removal of a plan in code
 * never rewrites historical invoices. Stripe (or any PSP) will fill these in
 * later via webhook; for now the table is the single source of truth.
 *
 * `organizationId` is a Zitadel-issued UUID — no FK, since Zitadel is a
 * separate database.
 */
export const invoice = menuSchema.table(
  'invoice',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull(),
    plan: text('plan').$type<PlanCode>().notNull(),
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    status: text('status').$type<InvoiceStatus>().notNull().default('paid'),
    issuedAt: timestamp('issued_at').notNull().defaultNow(),
    paidAt: timestamp('paid_at'),
  },
  (t) => [
    index('invoice_org_idx').on(t.organizationId),
    index('invoice_issued_at_idx').on(t.issuedAt),
  ],
)

// ─── QR codes ─────────────────────────────────────────────────────────────────
// Physical-sticker registry. Each `code` is a short token printed on a sticker
// (`menu.iedora.com/q/<code>`). An unbound row exists for "I printed it, haven't
// decided which restaurant yet"; admin (iedora-admin role) binds it later by
// setting `restaurantId`. `onDelete: 'set null'` keeps the sticker valid if a
// restaurant is later deleted — the code can be rebound rather than discarded.
//
// CRUD is Iedora-staff only (see `requireIedoraAdmin`); tenant scoping does
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
