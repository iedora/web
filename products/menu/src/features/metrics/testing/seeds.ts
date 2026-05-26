import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'

/**
 * Pre-seed a daily_view bucket. Useful for analytics-range specs that
 * need history without firing N beacons through the public route. For
 * happy-path beacon coverage use `@/shared/testing/e2e-beacon`.
 */
export async function seedDailyView(input: {
  organizationId: string
  restaurantId: string
  day: string // YYYY-MM-DD
  language?: string
  count?: number
}): Promise<void> {
  const sql = testDb()
  await sql`
    INSERT INTO "menu"."daily_view" (organization_id, restaurant_id, day, language, count)
    VALUES (
      ${input.organizationId},
      ${input.restaurantId},
      ${input.day},
      ${input.language ?? 'en'},
      ${input.count ?? 1}
    )
    ON CONFLICT (restaurant_id, day, language) DO UPDATE
      SET count = EXCLUDED.count
  `
}
