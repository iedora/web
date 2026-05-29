import 'server-only'
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { SpanStatusCode } from '@opentelemetry/api'
import { meter, tracer, IEDORA_RESTAURANT_ID, IEDORA_TENANT_ID } from '@iedora/observability'
import { db } from '../../../shared/db/client'
import * as schema from '../../../shared/db/schema'
import { category, item, menu, restaurant } from '../../../shared/db/schema'
import type { LanguageCode, LocalizedText } from '../../i18n'
import type { MenuReadPort, MenuWritePort } from '../ports'

/**
 * Reorder transaction latency, labeled by entity. Tail latency here is
 * the SLI for dnd-kit responsiveness — if the histogram p95 climbs, the
 * admin builder feels janky. Tenant attribution is auto-stamped by the
 * TenantContextSpanProcessor (the action shell calls
 * requireRestaurantAccess first, which seeds tenantContext via enterWith).
 */
const reorderDuration = meter.createHistogram(
  'iedora.menu_builder.reorder_duration_ms',
  {
    description:
      'Latency of single-statement reorder transactions (categories or items).',
    unit: 'ms',
  },
)

/** Small helper to wrap a Drizzle adapter call in a named span. */
async function tracedAdapterOp<T>(
  name: string,
  attrs: Record<string, string | number>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v)
    try {
      return await fn()
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      span.end()
    }
  })
}

// Generic over the driver — accepts both postgres-js (prod) and PGLite (tests).
type AdapterDb = PgDatabase<PgQueryResultHKT, typeof schema>

// INSERT … RETURNING from a single VALUES row always yields exactly one row,
// and aggregate SELECTs (max, count, …) always yield one row even on empty
// tables. TS can't model that, so this narrows the array type where Postgres
// guarantees it.
function only<T>(rows: T[], op: string): T {
  const row = rows[0]
  if (!row) throw new Error(`drizzle: ${op} returned no rows`)
  return row
}

/**
 * Production MenuWritePort. Wraps the Drizzle mutations that previously
 * lived inline in `app/dashboard/r/[slug]/m/[menuId]/actions.ts`. Single-
 * transaction reorder + position renumber stay in the adapter — they are
 * I/O-shaped, not business logic (AGENTS.md hard rule #7).
 *
 * Tests use `makeDrizzleMenuWrite(testDb)` to bind to a PGLite instance;
 * production uses the singleton bind below.
 */
export function makeDrizzleMenuWrite(db: AdapterDb): MenuWritePort {
  return {
  async findMenuInRestaurant(menuId, restaurantId) {
    return tracedAdapterOp(
      'db.find-menu-in-restaurant',
      { [IEDORA_RESTAURANT_ID]: restaurantId, 'iedora.menu_id': menuId },
      async () => {
        const rows = await db
          .select({ id: menu.id })
          .from(menu)
          .where(and(eq(menu.id, menuId), eq(menu.restaurantId, restaurantId)))
          .limit(1)
        return rows[0] ?? null
      },
    )
  },

  async findCategoryInRestaurant(categoryId, restaurantId) {
    return tracedAdapterOp(
      'db.find-category-in-restaurant',
      {
        [IEDORA_RESTAURANT_ID]: restaurantId,
        'iedora.category_id': categoryId,
      },
      async () => {
        const rows = await db
          .select({ id: category.id, menuId: category.menuId })
          .from(category)
          .where(
            and(
              eq(category.id, categoryId),
              eq(category.restaurantId, restaurantId),
            ),
          )
          .limit(1)
        return rows[0] ?? null
      },
    )
  },

  async findItemInRestaurant(itemId, restaurantId) {
    return tracedAdapterOp(
      'db.find-item-in-restaurant',
      { [IEDORA_RESTAURANT_ID]: restaurantId, 'iedora.item_id': itemId },
      async () => {
        const rows = await db
          .select({ id: item.id, categoryId: item.categoryId })
          .from(item)
          .where(
            and(eq(item.id, itemId), eq(item.restaurantId, restaurantId)),
          )
          .limit(1)
        return rows[0] ?? null
      },
    )
  },

  async insertCategoryAtEnd(menuId, restaurantId, name) {
    const agg = only(
      await db
        .select({ next: max(category.position) })
        .from(category)
        .where(eq(category.menuId, menuId)),
      'max(category.position)',
    )

    const row = only(
      await db
        .insert(category)
        .values({
          menuId,
          restaurantId,
          name,
          position: (agg.next ?? -1) + 1,
        })
        .returning({ id: category.id }),
      'insert category',
    )
    return row.id
  },

  async updateCategoryName(categoryId, name) {
    await db.update(category).set({ name }).where(eq(category.id, categoryId))
  },

  async updateCategoryTranslations(categoryId, fields) {
    await db
      .update(category)
      .set({
        name: fields.name,
        description: fields.description,
        nameI18n: fields.nameI18n,
        descriptionI18n: fields.descriptionI18n,
      })
      .where(eq(category.id, categoryId))
  },

  async deleteCategory(categoryId) {
    await db.delete(category).where(eq(category.id, categoryId))
  },

  async reorderCategories(menuId, restaurantId, orderedIds) {
    // Renumber positions 0..n-1 over the supplied order in ONE UPDATE.
    // Per-row UPDATE in a loop = N round-trips holding N row locks; this
    // collapses to a single statement using UPDATE … FROM (VALUES …).
    // Defence-in-depth: filter by menuId AND restaurantId (the action shell
    // already verified ownership, but tight WHERE protects against a stale
    // client id slipping across tenants). AGENTS.md hard rule #7.
    if (orderedIds.length === 0) return
    return tracer.startActiveSpan('db.reorder-categories', async (span) => {
      span.setAttribute(IEDORA_RESTAURANT_ID, restaurantId)
      span.setAttribute('iedora.menu_id', menuId)
      span.setAttribute('iedora.reorder.batch_size', orderedIds.length)
      const startedAt = performance.now()
      try {
        const values = sql.join(
          orderedIds.map((id, i) => sql`(${id}, ${i})`),
          sql`, `,
        )
        // Casts: VALUES columns come back as text by default; position is int.
        // Without the casts, Postgres returns 42804 "column "position" is of
        // type integer but expression is of type text".
        await db.execute(sql`
          UPDATE ${category}
          SET position = v.position::int
          FROM (VALUES ${values}) AS v(id, position)
          WHERE ${category.id} = v.id::text
            AND ${category.menuId} = ${menuId}
            AND ${category.restaurantId} = ${restaurantId}
        `)
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      } finally {
        reorderDuration.record(performance.now() - startedAt, {
          'iedora.reorder.entity': 'category',
        })
        span.end()
      }
    })
  },

  async updateMenu(menuId, fields) {
    await db
      .update(menu)
      .set({
        name: fields.name,
        description: fields.description,
        nameI18n: fields.nameI18n,
        descriptionI18n: fields.descriptionI18n,
      })
      .where(eq(menu.id, menuId))
  },

  async insertItemAtEnd(categoryId, restaurantId, fields) {
    const agg = only(
      await db
        .select({ next: max(item.position) })
        .from(item)
        .where(eq(item.categoryId, categoryId)),
      'max(item.position)',
    )

    // Variants are persisted at insert time when supplied, so the Add
    // dialog doesn't need a follow-up updateItem roundtrip. `null` /
    // `[]` collapse to `null` in the column (matches updateItem's
    // clear-variants semantics). `labelI18n` is round-tripped opaque —
    // when the operator hasn't translated yet, it's omitted from the
    // jsonb payload to keep rows compact.
    const initialVariants =
      fields.variants && fields.variants.length > 0
        ? fields.variants.map((v) => ({
            label: v.label,
            ...(v.labelI18n ? { labelI18n: v.labelI18n } : {}),
            priceCents: v.priceCents,
          }))
        : null

    const row = only(
      await db
        .insert(item)
        .values({
          categoryId,
          restaurantId,
          name: fields.name,
          priceCents: fields.priceCents,
          position: (agg.next ?? -1) + 1,
          variants: initialVariants,
        })
        .returning({ id: item.id }),
      'insert item',
    )
    return row.id
  },

  async updateItem(itemId, fields) {
    // Variants follow leave-alone semantics: `undefined` (the field
    // wasn't sent) means "don't touch the column". `null` or `[]` are
    // real operator actions — clear all variants on this item.
    const variantsPatch =
      fields.variants === undefined
        ? {}
        : {
            variants:
              fields.variants === null || fields.variants.length === 0
                ? null
                : fields.variants.map((v) => ({
                    label: v.label,
                    ...(v.labelI18n ? { labelI18n: v.labelI18n } : {}),
                    priceCents: v.priceCents,
                  })),
          }

    await db
      .update(item)
      .set({
        name: fields.name,
        description: fields.description,
        priceCents: fields.priceCents,
        available: fields.available,
        nameI18n: fields.nameI18n,
        descriptionI18n: fields.descriptionI18n,
        ...variantsPatch,
      })
      .where(eq(item.id, itemId))
  },

  async deleteItem(itemId) {
    await db.delete(item).where(eq(item.id, itemId))
  },

  async reorderItems(categoryId, restaurantId, orderedIds) {
    // Same shape as reorderCategories — single UPDATE FROM VALUES with casts.
    if (orderedIds.length === 0) return
    return tracer.startActiveSpan('db.reorder-items', async (span) => {
      span.setAttribute(IEDORA_RESTAURANT_ID, restaurantId)
      span.setAttribute('iedora.category_id', categoryId)
      span.setAttribute('iedora.reorder.batch_size', orderedIds.length)
      const startedAt = performance.now()
      try {
        const values = sql.join(
          orderedIds.map((id, i) => sql`(${id}, ${i})`),
          sql`, `,
        )
        await db.execute(sql`
          UPDATE ${item}
          SET position = v.position::int
          FROM (VALUES ${values}) AS v(id, position)
          WHERE ${item.id} = v.id::text
            AND ${item.categoryId} = ${categoryId}
            AND ${item.restaurantId} = ${restaurantId}
        `)
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      } finally {
        reorderDuration.record(performance.now() - startedAt, {
          'iedora.reorder.entity': 'item',
        })
        span.end()
      }
    })
  },

  async getRestaurantLanguageConfig(restaurantId) {
    const row = only(
      await db
        .select({
          defaultLanguage: restaurant.defaultLanguage,
          supportedLanguages: restaurant.supportedLanguages,
        })
        .from(restaurant)
        .where(eq(restaurant.id, restaurantId))
        .limit(1),
      'restaurant language config',
    )
    return {
      defaultLanguage: row.defaultLanguage as LanguageCode,
      supportedLanguages: row.supportedLanguages as LanguageCode[],
    }
  },

  async createMenu(restaurantId, name) {
    const agg = only(
      await db
        .select({ next: max(menu.position) })
        .from(menu)
        .where(eq(menu.restaurantId, restaurantId)),
      'max(menu.position)',
    )

    const row = only(
      await db
        .insert(menu)
        .values({
          restaurantId,
          name,
          position: (agg.next ?? -1) + 1,
        })
        .returning({ id: menu.id }),
      'insert menu',
    )
    return row.id
  },

  async deleteMenu(menuId, restaurantId) {
    await db
      .delete(menu)
      .where(and(eq(menu.id, menuId), eq(menu.restaurantId, restaurantId)))
  },

  async seedSampleMenu(restaurantId: string, seed: Parameters<MenuWritePort['seedSampleMenu']>[1]): Promise<string> {
    // Append after any existing menus so we never reuse a position. The whole
    // seed runs in a transaction (AGENTS.md hard rule #7) so a half-created
    // menu can't leak if anything along the way fails. The caller has
    // pre-localized text into `default` (plain column) + `i18n` (jsonb map)
    // following AGENTS.md hard rule #10.
    const nextMenuAgg = only(
      await db
        .select({ next: max(menu.position) })
        .from(menu)
        .where(eq(menu.restaurantId, restaurantId)),
      'max(menu.position)',
    )

    return db.transaction(async (tx) => {
      const insertedMenu = only(
        await tx
          .insert(menu)
          .values({
            restaurantId,
            name: seed.menuName.default,
            nameI18n: seed.menuName.i18n,
            position: (nextMenuAgg.next ?? -1) + 1,
          })
          .returning({ id: menu.id }),
        'insert seed menu',
      )

      for (const [catIdx, c] of seed.categories.entries()) {
        const insertedCategory = only(
          await tx
            .insert(category)
            .values({
              menuId: insertedMenu.id,
              restaurantId,
              name: c.name.default,
              nameI18n: c.name.i18n,
              position: catIdx * 10,
            })
            .returning({ id: category.id }),
          'insert seed category',
        )

        const itemRows = c.items.map((it, itemIdx) => ({
          categoryId: insertedCategory.id,
          restaurantId,
          name: it.name.default,
          nameI18n: it.name.i18n,
          description: it.description.default,
          descriptionI18n: it.description.i18n,
          priceCents: it.priceCents,
          currency: it.currency,
          position: itemIdx * 10,
          // Persist variants when supplied; null otherwise so the
          // column doesn't carry empty arrays for the common case.
          variants:
            it.variants && it.variants.length > 0
              ? it.variants.map((v) => ({
                  label: v.label,
                  priceCents: v.priceCents,
                }))
              : null,
        }))
        if (itemRows.length > 0) await tx.insert(item).values(itemRows)
      }

      return insertedMenu.id
    })
  },
  }
}

// Production singleton, bound to the postgres-js db.
export const drizzleMenuWrite = makeDrizzleMenuWrite(db)

/**
 * Production MenuReadPort. Pulls the menu + i18n config + categories with
 * their items in three queries (same shape the page used to issue inline).
 * Returns BuilderCategory[] — the shape the UI consumes directly.
 *
 * `makeDrizzleMenuRead(testDb)` for tests; singleton below for prod.
 */
export function makeDrizzleMenuRead(db: AdapterDb): MenuReadPort {
  return {
  async loadBuilderData(restaurantId, menuId) {
    const menuRows = await db
      .select({ id: menu.id, name: menu.name })
      .from(menu)
      .where(and(eq(menu.id, menuId), eq(menu.restaurantId, restaurantId)))
      .limit(1)
    const m = menuRows[0]
    if (!m) {
      return {
        menu: null,
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        categories: [],
      }
    }

    const langs = only(
      await db
        .select({
          defaultLanguage: restaurant.defaultLanguage,
          supportedLanguages: restaurant.supportedLanguages,
        })
        .from(restaurant)
        .where(eq(restaurant.id, restaurantId))
        .limit(1),
      'restaurant language config',
    )

    // Project explicitly — the table has `createdAt`/`updatedAt`/`restaurantId`
    // that the builder UI never reads. Smaller payloads = smaller cache
    // entries when this gets wrapped by Next's cache layers downstream.
    const categoryRows = await db
      .select({
        id: category.id,
        name: category.name,
        description: category.description,
        nameI18n: category.nameI18n,
        descriptionI18n: category.descriptionI18n,
      })
      .from(category)
      .where(eq(category.menuId, menuId))
      .orderBy(asc(category.position))

    const itemRows =
      categoryRows.length === 0
        ? []
        : await db
            .select({
              id: item.id,
              categoryId: item.categoryId,
              name: item.name,
              description: item.description,
              nameI18n: item.nameI18n,
              descriptionI18n: item.descriptionI18n,
              priceCents: item.priceCents,
              currency: item.currency,
              available: item.available,
              position: item.position,
              imageUrl: item.imageUrl,
              variants: item.variants,
            })
            .from(item)
            .where(
              inArray(
                item.categoryId,
                categoryRows.map((c) => c.id),
              ),
            )
            .orderBy(asc(item.position))

    const itemsByCategory: Record<string, typeof itemRows> = {}
    for (const c of categoryRows) itemsByCategory[c.id] = []
    for (const it of itemRows) itemsByCategory[it.categoryId]?.push(it)

    return {
      menu: m,
      defaultLanguage: langs.defaultLanguage,
      supportedLanguages: langs.supportedLanguages as string[],
      categories: categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        nameI18n: c.nameI18n as LocalizedText | null,
        descriptionI18n: c.descriptionI18n as LocalizedText | null,
        items: (itemsByCategory[c.id] ?? []).map((it) => ({
          id: it.id,
          categoryId: it.categoryId,
          name: it.name,
          description: it.description,
          nameI18n: it.nameI18n as LocalizedText | null,
          descriptionI18n: it.descriptionI18n as LocalizedText | null,
          priceCents: it.priceCents,
          currency: it.currency,
          available: it.available,
          position: it.position ?? 0,
          imageUrl: it.imageUrl,
          // Normalise jsonb `null` → `[]` so the builder UI iterates
          // without a branch. Variants round-trip `labelI18n` opaque
          // so the dish-edit dialog can show + edit translations.
          variants: ((it.variants as Array<{
            label: string
            labelI18n?: LocalizedText | null
            priceCents: number
          }> | null) ?? []).map((v) => ({
            label: v.label,
            labelI18n: v.labelI18n ?? null,
            priceCents: v.priceCents,
          })),
        })),
      })),
    }
  },
  }
}

export const drizzleMenuRead = makeDrizzleMenuRead(db)
