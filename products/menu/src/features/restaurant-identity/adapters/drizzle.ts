import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { restaurant } from '@/shared/db/schema'
import type { IdentityWritePort } from '../ports'

/**
 * Production IdentityWritePort. Wraps the Drizzle mutations that previously
 * lived inline in `app/dashboard/r/[slug]/theme/actions.ts`.
 */
export const drizzleIdentityWrite: IdentityWritePort = {
  async updateTheme(restaurantId, theme) {
    await db
      .update(restaurant)
      .set({ theme })
      .where(eq(restaurant.id, restaurantId))
  },

  async updateLanguageSettings(restaurantId, fields) {
    await db
      .update(restaurant)
      .set({
        defaultLanguage: fields.defaultLanguage,
        supportedLanguages: fields.supportedLanguages,
      })
      .where(eq(restaurant.id, restaurantId))
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

  async updateSlug(restaurantId, nextSlug) {
    // Cheap pre-check — if the slug already lives on a DIFFERENT row, fail
    // fast with a typed `taken` instead of letting the DB raise a unique-
    // violation we'd have to introspect. The DB's unique index is still
    // the source of truth for races: the second concurrent writer hits a
    // 23505 below and is bubbled up to the caller.
    const conflict = await db
      .select({ id: restaurant.id })
      .from(restaurant)
      .where(and(eq(restaurant.slug, nextSlug), ne(restaurant.id, restaurantId)))
      .limit(1)
    if (conflict.length > 0) {
      return { ok: false, reason: 'taken' }
    }
    try {
      await db
        .update(restaurant)
        .set({ slug: nextSlug })
        .where(eq(restaurant.id, restaurantId))
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code: string }).code
          : ''
      if (code === '23505') return { ok: false, reason: 'taken' }
      throw err
    }
    return { ok: true }
  },
}
