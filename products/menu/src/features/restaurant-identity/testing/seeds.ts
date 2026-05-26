import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'

/**
 * Restaurant-identity owns the `restaurant` row. Seeds insert directly via
 * SQL to skip the slug-validation / theme-defaulting that lives in the
 * production use-case — the goal is fixture setup, not exercising the
 * happy path of restaurant creation (that's covered by this slice's own
 * spec). The same shape mirrors what `restaurant.create` would persist.
 */

export type SeededRestaurant = {
  restaurantId: string
  slug: string
  name: string
  organizationId: string
}

export type SeedRestaurantInput = {
  organizationId: string
  name: string
  slug: string
  defaultLanguage?: string
  supportedLanguages?: string[]
  description?: string
}

export async function seedRestaurant(
  input: SeedRestaurantInput,
): Promise<SeededRestaurant> {
  const sql = testDb()
  const defaultLanguage = input.defaultLanguage ?? 'en'
  const supportedLanguages = JSON.stringify(input.supportedLanguages ?? [defaultLanguage])

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "menu"."restaurant" (
      id, organization_id, name, slug, description,
      default_language, supported_languages, updated_at
    )
    VALUES (
      gen_random_uuid()::text,
      ${input.organizationId},
      ${input.name},
      ${input.slug},
      ${input.description ?? null},
      ${defaultLanguage},
      ${supportedLanguages}::jsonb,
      now()
    )
    RETURNING id
  `
  return {
    restaurantId: row!.id,
    slug: input.slug,
    name: input.name,
    organizationId: input.organizationId,
  }
}
