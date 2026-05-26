/**
 * Drizzle adapter for the menu-translation slice.
 *
 * Reads stale items + categories under a restaurant; writes the
 * machine-translated overrides back and bumps `translations_synced_at`
 * inside a single transaction so a partial failure can't leave rows
 * marked "synced" without their overrides.
 */
import 'server-only'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { db } from '@/shared/db/client'
import {
  category,
  item,
  restaurant,
  type ItemVariant,
} from '@/shared/db/schema'
import type { StaleRow, TranslationDataPort } from '../ports'

export const drizzleTranslationData: TranslationDataPort = {
  async findStale(restaurantId) {
    // Stale = never synced OR source updated after last sync. Inline the
    // comparison for each table; drizzle's column types are per-table so
    // a shared helper trips generic inference.
    const items = await db
      .select({
        id: item.id,
        name: item.name,
        nameI18n: item.nameI18n,
        description: item.description,
        descriptionI18n: item.descriptionI18n,
        variants: item.variants,
      })
      .from(item)
      .where(
        and(
          eq(item.restaurantId, restaurantId),
          or(
            isNull(item.translationsSyncedAt),
            sql`${item.translationsSyncedAt} < ${item.updatedAt}`,
          ),
        ),
      )

    const categories = await db
      .select({
        id: category.id,
        name: category.name,
        nameI18n: category.nameI18n,
        description: category.description,
        descriptionI18n: category.descriptionI18n,
      })
      .from(category)
      .where(
        and(
          eq(category.restaurantId, restaurantId),
          or(
            isNull(category.translationsSyncedAt),
            sql`${category.translationsSyncedAt} < ${category.updatedAt}`,
          ),
        ),
      )

    const rows: StaleRow[] = []
    for (const c of categories) {
      if (!c.name || c.name.trim().length === 0) continue
      rows.push({
        rowKind: 'category',
        id: c.id,
        name: c.name,
        nameI18n: (c.nameI18n as LocalizedText | null) ?? null,
        description: c.description,
        descriptionI18n: (c.descriptionI18n as LocalizedText | null) ?? null,
      })
    }
    for (const it of items) {
      if (!it.name || it.name.trim().length === 0) continue
      rows.push({
        rowKind: 'item',
        id: it.id,
        name: it.name,
        nameI18n: (it.nameI18n as LocalizedText | null) ?? null,
        description: it.description,
        descriptionI18n: (it.descriptionI18n as LocalizedText | null) ?? null,
        // Pass variants through opaque — the use-case decides which
        // labels to send to the translator and assembles the result.
        variants: (it.variants as ItemVariant[] | null) ?? null,
      })
    }
    return rows
  },

  async applyTranslations(restaurantId, updates) {
    if (updates.length === 0) return

    await db.transaction(async (tx) => {
      const now = new Date()
      for (const u of updates) {
        // Defence-in-depth — every UPDATE is also scoped to restaurantId
        // so a stray id from a different tenant could never be rewritten.
        if (u.rowKind === 'item') {
          // Variants follow the use-case's leave-alone semantics:
          // `undefined` (key absent in the projection) = don't touch
          // the column; an explicit array (incl. []) writes the new
          // value. Empty array is normalised to null upstream.
          const variantsPatch =
            u.variants === undefined ? {} : { variants: u.variants }
          await tx
            .update(item)
            .set({
              nameI18n: u.nameI18n as LocalizedText | null,
              descriptionI18n: u.descriptionI18n as LocalizedText | null,
              translationsSyncedAt: now,
              ...variantsPatch,
            })
            .where(and(eq(item.id, u.id), eq(item.restaurantId, restaurantId)))
        } else {
          await tx
            .update(category)
            .set({
              nameI18n: u.nameI18n as LocalizedText | null,
              descriptionI18n: u.descriptionI18n as LocalizedText | null,
              translationsSyncedAt: now,
            })
            .where(
              and(
                eq(category.id, u.id),
                eq(category.restaurantId, restaurantId),
              ),
            )
        }
      }
    })
  },

  async getRestaurantLanguageConfig(restaurantId) {
    const [row] = await db
      .select({
        defaultLanguage: restaurant.defaultLanguage,
        supportedLanguages: restaurant.supportedLanguages,
      })
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1)
    if (!row) {
      throw new Error(
        `restaurant ${restaurantId} not found while loading language config`,
      )
    }
    return {
      defaultLanguage: row.defaultLanguage as LanguageCode,
      supportedLanguages: (row.supportedLanguages as LanguageCode[]) ?? [
        row.defaultLanguage as LanguageCode,
      ],
    }
  },
}
