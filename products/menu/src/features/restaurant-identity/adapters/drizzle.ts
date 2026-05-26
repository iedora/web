import 'server-only'
import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { db } from '@/shared/db/client'
import * as schema from '@/shared/db/schema'
import {
  category as categoryTable,
  item as itemTable,
  restaurant,
  type ItemVariant,
} from '@/shared/db/schema'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import {
  promoteField,
  promoteNullableField,
  promoteVariants,
} from '../use-cases/promote-default-language'
import type { IdentityWritePort } from '../ports'

// Generic over the driver — accepts both postgres-js (prod) and PGLite (tests).
type AdapterDb = PgDatabase<PgQueryResultHKT, typeof schema>

/**
 * Production IdentityWritePort. Wraps the Drizzle mutations that previously
 * lived inline in `app/dashboard/r/[slug]/theme/actions.ts`.
 *
 * Tests use `makeDrizzleIdentityWrite(testDb)` to bind to a PGLite
 * instance; production uses the singleton bind at the bottom of the
 * file.
 */
export function makeDrizzleIdentityWrite(db: AdapterDb): IdentityWritePort {
  return {
  async updateTheme(restaurantId, theme) {
    await db
      .update(restaurant)
      .set({ theme })
      .where(eq(restaurant.id, restaurantId))
  },

  async updateLanguageSettings(restaurantId, fields) {
    // One transaction for the whole flip — partial promotion would
    // leave the restaurant in an inconsistent state where some rows
    // use newDefault as their source and others still hold oldDefault.
    return await db.transaction(async (tx) => {
      // Read the current default. If unchanged, no promotion needed.
      const [current] = await tx
        .select({ defaultLanguage: restaurant.defaultLanguage })
        .from(restaurant)
        .where(eq(restaurant.id, restaurantId))
        .limit(1)

      const oldDefault = current?.defaultLanguage as LanguageCode | undefined
      const newDefault = fields.defaultLanguage
      const defaultChanged = Boolean(oldDefault && oldDefault !== newDefault)

      let rowsPromoted = 0
      let rowsNeedingAttention = 0

      if (defaultChanged && oldDefault) {
        // ─── Restaurant.description ────────────────────────────────
        const [r] = await tx
          .select({
            description: restaurant.description,
            descriptionI18n: restaurant.descriptionI18n,
          })
          .from(restaurant)
          .where(eq(restaurant.id, restaurantId))
          .limit(1)
        if (r) {
          const promoted = promoteNullableField(
            r.description,
            r.descriptionI18n as LocalizedText | null,
            oldDefault,
            newDefault,
          )
          if (promoted.promoted) rowsPromoted += 1
          if (promoted.needsAttention) rowsNeedingAttention += 1
          await tx
            .update(restaurant)
            .set({
              description: promoted.source,
              descriptionI18n: promoted.i18n,
            })
            .where(eq(restaurant.id, restaurantId))
        }

        // ─── Categories.name + description ─────────────────────────
        const categories = await tx
          .select({
            id: categoryTable.id,
            name: categoryTable.name,
            nameI18n: categoryTable.nameI18n,
            description: categoryTable.description,
            descriptionI18n: categoryTable.descriptionI18n,
          })
          .from(categoryTable)
          .where(eq(categoryTable.restaurantId, restaurantId))
        for (const c of categories) {
          const n = promoteField(
            c.name,
            c.nameI18n as LocalizedText | null,
            oldDefault,
            newDefault,
          )
          const d = promoteNullableField(
            c.description,
            c.descriptionI18n as LocalizedText | null,
            oldDefault,
            newDefault,
          )
          if (n.promoted) rowsPromoted += 1
          if (d.promoted) rowsPromoted += 1
          if (n.needsAttention) rowsNeedingAttention += 1
          if (d.needsAttention) rowsNeedingAttention += 1
          await tx
            .update(categoryTable)
            .set({
              name: n.source,
              nameI18n: n.i18n,
              description: d.source,
              descriptionI18n: d.i18n,
            })
            .where(eq(categoryTable.id, c.id))
        }

        // ─── Items.name + description + variants[].label ────────────
        const items = await tx
          .select({
            id: itemTable.id,
            name: itemTable.name,
            nameI18n: itemTable.nameI18n,
            description: itemTable.description,
            descriptionI18n: itemTable.descriptionI18n,
            variants: itemTable.variants,
          })
          .from(itemTable)
          .where(eq(itemTable.restaurantId, restaurantId))
        for (const it of items) {
          const n = promoteField(
            it.name,
            it.nameI18n as LocalizedText | null,
            oldDefault,
            newDefault,
          )
          const d = promoteNullableField(
            it.description,
            it.descriptionI18n as LocalizedText | null,
            oldDefault,
            newDefault,
          )
          const v = promoteVariants(
            it.variants as ItemVariant[] | null,
            oldDefault,
            newDefault,
          )
          if (n.promoted) rowsPromoted += 1
          if (d.promoted) rowsPromoted += 1
          rowsPromoted += v.promoted
          if (n.needsAttention) rowsNeedingAttention += 1
          if (d.needsAttention) rowsNeedingAttention += 1
          rowsNeedingAttention += v.needsAttention
          await tx
            .update(itemTable)
            .set({
              name: n.source,
              nameI18n: n.i18n,
              description: d.source,
              descriptionI18n: d.i18n,
              variants: v.variants.length === 0 ? null : v.variants,
            })
            .where(eq(itemTable.id, it.id))
        }
      }

      // Finally write the new language config itself.
      await tx
        .update(restaurant)
        .set({
          defaultLanguage: newDefault,
          supportedLanguages: fields.supportedLanguages,
        })
        .where(eq(restaurant.id, restaurantId))

      return { defaultChanged, rowsPromoted, rowsNeedingAttention }
    })
  },

  async updateIdentity(restaurantId, fields) {
    await db
      .update(restaurant)
      .set({
        name: fields.name,
        description: fields.description,
        descriptionI18n: fields.descriptionI18n,
      })
      .where(eq(restaurant.id, restaurantId))
  },
  }
}

export const drizzleIdentityWrite = makeDrizzleIdentityWrite(db)
