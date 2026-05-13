import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { restaurant } from '@/lib/db/schema'
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
}
