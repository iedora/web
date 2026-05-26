import 'server-only'
import { eq } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { SpanStatusCode } from '@opentelemetry/api'
import { meter, tenantContext, tracer, IEDORA_RESTAURANT_ID, IEDORA_ORGANIZATION_ID } from '@iedora/observability'
import { db } from '@/shared/db/client'
import { restaurant, type RestaurantTheme } from '@/shared/db/schema'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { loadMenuTree, type RawMenu } from './load-tree'
import { restaurantTag } from '../cache'

/**
 * Latency of the snapshot load call as seen by the page. Bimodal in
 * practice: cache hits land in single-digit ms, cache misses land in
 * the tens-to-hundreds of ms (DB row + tree walk). The histogram is
 * the right way to see both modes — averaging them hides the signal.
 *
 * `outcome` label values:
 *   - `hit` is NOT observable from outside `unstable_cache`, so we
 *     don't try to label it. Instead, the histogram lets dashboards
 *     pick out the bimodal shape; the SLI is the P95.
 *   - `found` / `not-found` distinguish slug-exists vs 404.
 *   - `failed` covers DB errors propagated out of the loader.
 */
const snapshotLoadDuration = meter.createHistogram(
  'iedora.menu.snapshot_load_duration_ms',
  {
    description:
      'Latency of loadRestaurantSnapshot — includes cache machinery + DB load on miss.',
    unit: 'ms',
  },
)

/**
 * Cache miss → DB-compute path latency. ONLY records on miss (the inner
 * function isn't invoked on hit). Pair with snapshotLoadDuration to see
 * "how much of total load latency is spent in the DB vs the cache layer".
 */
const snapshotComputeDuration = meter.createHistogram(
  'iedora.menu.snapshot_compute_duration_ms',
  {
    description:
      'Latency of the snapshot DB load on cache miss only (restaurant row + tree walk).',
    unit: 'ms',
  },
)

/**
 * The public menu page is read-heavy and changes only when the admin edits
 * something. Caching the snapshot per restaurant lets the page serve from
 * memory until the next mutation, instead of hitting the DB on every scan.
 *
 * Why a function and not `unstable_cache(...)` at module scope:
 *   `unstable_cache` takes `tags` as a static array at definition time, so we
 *   can't bake `restaurant:${slug}` into a single-shared closure. Wrapping
 *   per-call gives us per-slug tags while still hitting the same backend
 *   cache entry (the entry is keyed off `keyParts`, which includes slug).
 *
 * Why a snapshot vs. full localized page output:
 *   Language picking depends on the visitor's `accept-language` header and
 *   `?lang=` param — both Request-time inputs. Caching the raw row + tree
 *   keeps the cache key down to `slug`; the page then localizes in memory.
 *   The localization step is a pure JSON walk and doesn't need its own cache.
 *
 * `revalidate: false` → entries live until `revalidateRestaurant(slug)` is
 * called. Stripe-style background refresh isn't useful here; a menu only
 * changes when the admin saves.
 */

export type RestaurantSnapshot = {
  id: string
  organizationId: string
  name: string
  slug: string
  description: string | null
  descriptionI18n: LocalizedText | null
  logoUrl: string | null
  bannerUrl: string | null
  theme: RestaurantTheme | null
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  /** Active-only menu tree. The public page never needs disabled menus. */
  tree: RawMenu[]
}

export async function loadRestaurantSnapshot(
  slug: string,
): Promise<RestaurantSnapshot | null> {
  return tracer.startActiveSpan('menu.load-snapshot', async (span) => {
    span.setAttribute('iedora.restaurant_slug', slug)
    const startedAt = performance.now()
    let outcome: 'found' | 'not-found' | 'failed' = 'failed'
    try {
      const result = await unstable_cache(
        async (s: string): Promise<RestaurantSnapshot | null> =>
          tracer.startActiveSpan('menu.load-snapshot.compute', async (inner) => {
            inner.setAttribute('iedora.restaurant_slug', s)
            const computeStart = performance.now()
            try {
              const rows = await db
                .select({
                  id: restaurant.id,
                  organizationId: restaurant.organizationId,
                  name: restaurant.name,
                  slug: restaurant.slug,
                  description: restaurant.description,
                  descriptionI18n: restaurant.descriptionI18n,
                  logoUrl: restaurant.logoUrl,
                  bannerUrl: restaurant.bannerUrl,
                  theme: restaurant.theme,
                  defaultLanguage: restaurant.defaultLanguage,
                  supportedLanguages: restaurant.supportedLanguages,
                })
                .from(restaurant)
                .where(eq(restaurant.slug, s))
                .limit(1)
              const r = rows[0]
              if (!r) {
                inner.setAttribute('iedora.outcome', 'not-found')
                return null
              }

              const tree = await loadMenuTree({
                restaurantId: r.id,
                activeOnly: true,
              })

              inner.setAttribute('iedora.outcome', 'found')
              inner.setAttribute(IEDORA_RESTAURANT_ID, r.id)
              inner.setAttribute(IEDORA_ORGANIZATION_ID, r.organizationId)
              inner.setAttribute('iedora.tree_menu_count', tree.length)
              return {
                id: r.id,
                organizationId: r.organizationId,
                name: r.name,
                slug: r.slug,
                description: r.description,
                descriptionI18n: r.descriptionI18n as LocalizedText | null,
                logoUrl: r.logoUrl,
                bannerUrl: r.bannerUrl,
                theme: r.theme as RestaurantTheme | null,
                defaultLanguage: r.defaultLanguage as LanguageCode,
                supportedLanguages: r.supportedLanguages as LanguageCode[],
                tree,
              }
            } finally {
              snapshotComputeDuration.record(performance.now() - computeStart)
              inner.end()
            }
          }),
        [`restaurant-snapshot:${slug}`],
        { tags: [restaurantTag(slug)], revalidate: false },
      )(slug)
      outcome = result === null ? 'not-found' : 'found'
      span.setAttribute('iedora.outcome', outcome)
      if (result) {
        span.setAttribute(IEDORA_RESTAURANT_ID, result.id)
        span.setAttribute(IEDORA_ORGANIZATION_ID, result.organizationId)
        // Seed the tenant context for the remainder of this request's
        // async chain. The public menu route (/r/[slug]) does NOT go
        // through requireRestaurantAccess (no auth), so without this
        // call the TenantContextSpanProcessor would never see the
        // restaurant id and downstream spans (Drizzle queries from
        // related slices, outbound fetches, render spans) would be
        // missing tenant.restaurant_id / tenant.organization_id —
        // breaking the per-tenant dashboards.
        //
        // The snapshot loader is the canonical chokepoint for both
        // public and admin reads of a restaurant, so seeding here
        // covers both paths uniformly. Auth-only routes still seed via
        // requireRestaurantAccess earlier in the chain; enterWith is
        // idempotent and the later call inside loadRestaurantSnapshot
        // is harmless (same values).
        tenantContext.enterWith({
          restaurantId: result.id,
          organizationId: result.organizationId,
        })
      }
      return result
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      snapshotLoadDuration.record(performance.now() - startedAt, {
        'iedora.outcome': outcome,
      })
      span.end()
    }
  })
}
