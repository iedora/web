import 'server-only'
import { and, count, eq, gte, lte, max, sql } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { dailyView, item, menu, restaurant } from '@/shared/db/schema'
import type { LanguageCode } from '@/features/i18n'
import type { MetricsGateway } from '../ports'

/**
 * Production MetricsGateway. Wraps Drizzle reads/writes against `daily_view`,
 * `menu`, `item`, and `restaurant`. Server-only — the Drizzle client never
 * belongs on the client.
 *
 * The `incrementDailyView` upsert MUST stay atomic: a single statement with
 * `onConflictDoUpdate` on `(restaurantId, day, language)` is hard-rule-#13
 * shape. Don't split it into a read-then-write — the beacon races with itself
 * on the same hour bucket from multiple devices behind the same NAT and the
 * conflict path is the hot path.
 */
export const drizzleMetrics: MetricsGateway = {
  async incrementDailyView({ restaurantId, organizationId, day, language }) {
    await db
      .insert(dailyView)
      .values({
        restaurantId,
        organizationId,
        day,
        language,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [dailyView.restaurantId, dailyView.day, dailyView.language],
        set: { count: sql`${dailyView.count} + 1` },
      })
  },

  async sumScans(organizationId, start, end) {
    const rows = await db
      .select({
        total: sql<number>`coalesce(sum(${dailyView.count}), 0)::int`,
      })
      .from(dailyView)
      .where(
        and(
          eq(dailyView.organizationId, organizationId),
          gte(dailyView.day, start),
          lte(dailyView.day, end),
        ),
      )
    return Number(rows[0]?.total ?? 0)
  },

  async dailyBreakdown(organizationId, start, end) {
    return db
      .select({
        day: dailyView.day,
        count: sql<number>`sum(${dailyView.count})::int`,
      })
      .from(dailyView)
      .where(
        and(
          eq(dailyView.organizationId, organizationId),
          gte(dailyView.day, start),
          lte(dailyView.day, end),
        ),
      )
      .groupBy(dailyView.day)
  },

  async getOrgContent(organizationId) {
    const [menuRows, dishRow, restaurants] = await Promise.all([
      db
        .select({ active: menu.active, n: count() })
        .from(menu)
        .innerJoin(restaurant, eq(restaurant.id, menu.restaurantId))
        .where(eq(restaurant.organizationId, organizationId))
        .groupBy(menu.active),
      db
        .select({
          n: count(),
          lastAddedAt: max(item.createdAt),
        })
        .from(item)
        .innerJoin(restaurant, eq(restaurant.id, item.restaurantId))
        .where(eq(restaurant.organizationId, organizationId)),
      db
        .select({ supportedLanguages: restaurant.supportedLanguages })
        .from(restaurant)
        .where(eq(restaurant.organizationId, organizationId)),
    ])

    return {
      menus: menuRows.map((r) => ({
        active: r.active,
        n: Number(r.n),
      })),
      dishes: {
        n: Number(dishRow[0]?.n ?? 0),
        lastAddedAt: dishRow[0]?.lastAddedAt ?? null,
      },
      supportedLanguageSets: restaurants.map(
        (r) => (r.supportedLanguages ?? []) as LanguageCode[],
      ),
    }
  },
}
