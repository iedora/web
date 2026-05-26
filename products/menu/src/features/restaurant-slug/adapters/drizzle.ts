import 'server-only'
import { and, eq, like, ne, or } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { restaurant } from '@/shared/db/schema'
import type { SlugRegistry } from '../ports'

/**
 * Production SlugRegistry. The `restaurant.slug` column has a unique
 * index, so race-safety hinges on:
 *
 *   1. `findMatching` returns a snapshot — concurrent writers can both
 *      see `sushi-place-2` as free.
 *   2. `rename` does a cheap pre-check (slug claimed by a different
 *      restaurant?) and falls through to an UPDATE. The DB's unique
 *      index is the canonical race winner; we map its 23505 to
 *      `{ok:false, reason:'taken'}` so callers get a typed error.
 */
export const drizzleSlugRegistry: SlugRegistry = {
  async findMatching(base) {
    const rows = await db
      .select({ slug: restaurant.slug })
      .from(restaurant)
      .where(
        or(
          eq(restaurant.slug, base),
          like(restaurant.slug, `${base}-%`),
        ),
      )
    return rows.map((r) => r.slug)
  },

  async rename(restaurantId, newSlug) {
    const conflict = await db
      .select({ id: restaurant.id })
      .from(restaurant)
      .where(and(eq(restaurant.slug, newSlug), ne(restaurant.id, restaurantId)))
      .limit(1)
    if (conflict.length > 0) {
      return { ok: false, reason: 'taken' }
    }
    try {
      await db
        .update(restaurant)
        .set({ slug: newSlug })
        .where(eq(restaurant.id, restaurantId))
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code: string }).code
          : ''
      // 23505 = Postgres unique_violation. Concurrent writer won.
      if (code === '23505') return { ok: false, reason: 'taken' }
      throw err
    }
    return { ok: true }
  },
}
