import 'server-only'
import { eq } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { SpanStatusCode } from '@opentelemetry/api'
import { meter, tracer, IEDORA_RESTAURANT_ID, IEDORA_ORGANIZATION_ID } from '@iedora/observability'
import { listMenusWithCounts, type MenuWithCounts } from '@/features/dashboard-home'
import { db } from '@/shared/db/client'
import { restaurant } from '@/shared/db/schema'
import { restaurantTag } from '../cache'

const adminMenusLoadDuration = meter.createHistogram(
  'iedora.menu.admin_menus_load_duration_ms',
  {
    description:
      'Latency of loadRestaurantAdminMenus — dashboard list with per-menu counts.',
    unit: 'ms',
  },
)

/**
 * Cached menus-with-counts for the admin `/dashboard/r/[slug]` page. Auth and
 * tenant scoping live in `requireRestaurantBySlug` — that DAL call happens
 * per request, OUTSIDE this cache, and is the source of truth for "may this
 * caller see this restaurant".
 *
 * The cache key is the slug; the tag is the same `restaurant:${slug}` the
 * mutations already invalidate, so every menu/category/item/theme save the
 * admin makes shows up on the next render without per-mutation plumbing.
 *
 * Returns `null` when the slug doesn't exist — the page already 404s via the
 * auth guard before reaching here, but the null branch keeps the type honest.
 */
export type AdminMenusSnapshot = {
  restaurantId: string
  menus: MenuWithCounts[]
}

export async function loadRestaurantAdminMenus(
  slug: string,
): Promise<AdminMenusSnapshot | null> {
  return tracer.startActiveSpan('menu.load-admin-menus', async (span) => {
    span.setAttribute('iedora.restaurant_slug', slug)
    const startedAt = performance.now()
    let outcome: 'found' | 'not-found' | 'failed' = 'failed'
    try {
      const cached = await unstable_cache(
        async (s: string): Promise<AdminMenusSnapshot | null> => {
          const rows = await db
            .select({ id: restaurant.id })
            .from(restaurant)
            .where(eq(restaurant.slug, s))
            .limit(1)
          const r = rows[0]
          if (!r) return null

          const menus = await listMenusWithCounts(r.id)
          return { restaurantId: r.id, menus }
        },
        [`restaurant-admin-menus:${slug}`],
        { tags: [restaurantTag(slug)], revalidate: false },
      )(slug)
      if (!cached) {
        outcome = 'not-found'
        span.setAttribute('iedora.outcome', outcome)
        return null
      }
      outcome = 'found'
      span.setAttribute('iedora.outcome', outcome)
      span.setAttribute(IEDORA_RESTAURANT_ID, cached.restaurantId)
      span.setAttribute('iedora.menu_count', cached.menus.length)

      // unstable_cache serializes through JSON, which collapses Date → ISO string.
      // Re-hydrate any timestamp the caller will pass into date-formatting helpers
      // — otherwise `m.updatedAt.getTime is not a function` on a cache hit.
      return {
        restaurantId: cached.restaurantId,
        menus: cached.menus.map((m) => ({
          ...m,
          updatedAt:
            m.updatedAt instanceof Date
              ? m.updatedAt
              : new Date(m.updatedAt as unknown as string),
        })),
      }
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      adminMenusLoadDuration.record(performance.now() - startedAt, {
        'iedora.outcome': outcome,
      })
      span.end()
    }
  })
}
