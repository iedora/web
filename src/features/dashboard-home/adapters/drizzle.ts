import 'server-only'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { category, item, menu, restaurant } from '@/shared/db/schema'
import type { DashboardReadPort } from '../ports'

/**
 * Production DashboardReadPort. Wraps Drizzle reads against the
 * `restaurant`, `menu`, `category`, and `item` tables.
 *
 * Important: drizzle's `sql` template literal does NOT auto-qualify column
 * references inside subqueries — interpolating ${table.column} in a
 * correlated subquery rendered as a bare `"column"` and silently resolved
 * against the inner FROM, producing 0 for every row. (See commit 798d09e.)
 * These queries are written as separate small queries merged in JS rather
 * than a single CROSS JOIN with COUNT(DISTINCT ...) so the SQL stays simple
 * and reviewable.
 *
 * `count(*)::int` casts on each count: postgres returns count() as bigint,
 * which postgres-js surfaces as a JS string. The string then breaks ICU
 * plural's `#` substitution downstream. The cast keeps everything as a JS
 * number end-to-end.
 */
export const drizzleDashboardRead: DashboardReadPort = {
  async listRestaurantsWithCounts(organizationId) {
    const restaurants = await db
      .select({
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        updatedAt: restaurant.updatedAt,
      })
      .from(restaurant)
      .where(eq(restaurant.organizationId, organizationId))
      .orderBy(restaurant.createdAt)

    if (restaurants.length === 0) return []

    const ids = restaurants.map((r) => r.id)

    const [menuCounts, dishCounts] = await Promise.all([
      db
        .select({
          restaurantId: menu.restaurantId,
          count: sql<number>`count(${menu.id})::int`,
        })
        .from(menu)
        .where(inArray(menu.restaurantId, ids))
        .groupBy(menu.restaurantId),
      db
        .select({
          restaurantId: item.restaurantId,
          count: sql<number>`count(${item.id})::int`,
        })
        .from(item)
        .where(inArray(item.restaurantId, ids))
        .groupBy(item.restaurantId),
    ])

    const menuMap = new Map(menuCounts.map((m) => [m.restaurantId, m.count]))
    const dishMap = new Map(dishCounts.map((d) => [d.restaurantId, d.count]))

    return restaurants.map((r) => ({
      ...r,
      menuCount: menuMap.get(r.id) ?? 0,
      dishCount: dishMap.get(r.id) ?? 0,
    }))
  },

  async listMenusWithCounts(restaurantId) {
    const menus = await db
      .select({
        id: menu.id,
        name: menu.name,
        active: menu.active,
        position: menu.position,
        updatedAt: menu.updatedAt,
      })
      .from(menu)
      .where(eq(menu.restaurantId, restaurantId))
      .orderBy(menu.position)

    if (menus.length === 0) return []

    const ids = menus.map((m) => m.id)

    // Category counts are a single grouped query.
    // Dish counts go through category to find menus they belong to: a menu's
    // dish count is the count of items whose category belongs to that menu.
    const [categoryCounts, dishCountsByMenu] = await Promise.all([
      db
        .select({
          menuId: category.menuId,
          count: sql<number>`count(${category.id})::int`,
        })
        .from(category)
        .where(inArray(category.menuId, ids))
        .groupBy(category.menuId),
      db
        .select({
          menuId: category.menuId,
          count: sql<number>`count(${item.id})::int`,
        })
        .from(category)
        .leftJoin(item, eq(item.categoryId, category.id))
        .where(inArray(category.menuId, ids))
        .groupBy(category.menuId),
    ])

    const catMap = new Map(categoryCounts.map((c) => [c.menuId, c.count]))
    const dishMap = new Map(dishCountsByMenu.map((d) => [d.menuId, d.count]))

    return menus.map((m) => ({
      ...m,
      categoryCount: catMap.get(m.id) ?? 0,
      dishCount: dishMap.get(m.id) ?? 0,
    }))
  },
}
