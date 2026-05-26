'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantBySlug } from '@/features/auth'
import { revalidateRestaurant } from '@/features/menu-publishing'
import { enforceRateLimit } from '@/features/rate-limit'
import { rename as runRenameSlug } from '@/features/restaurant-slug'
import { drizzleIdentityWrite } from './adapters/drizzle'
import { updateTheme as runUpdateTheme } from './use-cases/update-theme'
import { updateLanguageSettings as runUpdateLanguageSettings } from './use-cases/update-language-settings'
import { updateIdentity as runUpdateIdentity } from './use-cases/update-identity'

/**
 * Server action shells — each one: auth guard → run use-case → revalidate.
 * Every mutation that affects the public menu calls `revalidateRestaurant`
 * (AGENTS.md hard rule #12). The dashboard path revalidation is kept on
 * purpose — tag-only invalidation is a later step in the migration.
 */

type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Specialised result for the language-settings action — carries the
 * promote-on-switch counters so the Theme editor can render a one-shot
 * "X rows need attention" banner. Bare `{ ok: true }` callers can still
 * narrow on the discriminant; the extra fields are present but ignored.
 */
type UpdateLanguageSettingsActionResult =
  | {
      ok: true
      /** Did the default language change in this save? */
      defaultChanged: boolean
      /** Source columns rewritten by the promotion. */
      rowsPromoted: number
      /** Rows with content but no translation to promote — operator must fix. */
      rowsNeedingAttention: number
    }
  | { ok: false; error: string }

async function gateIdentity(slug: string): Promise<
  | { ok: true; restaurantId: string }
  | { ok: false; error: string }
> {
  const { restaurant: r, organizationId } = await requireRestaurantBySlug(slug)
  const decision = await enforceRateLimit('identity', `org:${organizationId}`)
  if (!decision.ok) {
    return { ok: false, error: `Too many requests. Try again in ${decision.retryAfterSec}s.` }
  }
  return { ok: true, restaurantId: r.id }
}

export async function updateTheme(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const guarded = await gateIdentity(slug)
  if (!guarded.ok) return guarded
  const res = await runUpdateTheme(drizzleIdentityWrite, {
    ...(typeof input === 'object' && input !== null ? input : {}),
    restaurantId: guarded.restaurantId,
  })
  if ('error' in res) return { ok: false, error: res.error }
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
  return { ok: true }
}

/**
 * Promote-on-switch is implemented in the adapter — when
 * `defaultLanguage` changes, every translatable row (restaurant
 * description, all categories' name + description, all items' name +
 * description, all items' variants' labels) is rotated inside a single
 * transaction: the new-default's translation moves to the source
 * column; the old source value moves to `i18n[oldDefault]`.
 *
 * Rows that had no translation to promote get counted under
 * `rowsNeedingAttention` — we log that count server-side via
 * `console.warn` for now. TODO(language-switch-ui): surface the count
 * back to the Theme editor so the operator sees a one-time "X rows
 * need attention" banner after switching.
 */
export async function updateLanguageSettings(
  slug: string,
  input: unknown,
): Promise<UpdateLanguageSettingsActionResult> {
  const guarded = await gateIdentity(slug)
  if (!guarded.ok) return { ok: false, error: guarded.error }
  const res = await runUpdateLanguageSettings(drizzleIdentityWrite, {
    ...(typeof input === 'object' && input !== null ? input : {}),
    restaurantId: guarded.restaurantId,
  })
  if ('error' in res) return { ok: false, error: res.error }
  if (res.defaultChanged) {
    // Operator-relevant signal; kept as a log line in addition to the
    // UI banner so the data flip stays observable in prod.
    console.warn(
      '[restaurant-identity] default language changed',
      JSON.stringify({
        slug,
        rowsPromoted: res.rowsPromoted,
        rowsNeedingAttention: res.rowsNeedingAttention,
      }),
    )
  }
  revalidatePath(`/dashboard/r/${slug}`)
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
  return {
    ok: true,
    defaultChanged: res.defaultChanged,
    rowsPromoted: res.rowsPromoted,
    rowsNeedingAttention: res.rowsNeedingAttention,
  }
}

export async function updateIdentity(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const guarded = await gateIdentity(slug)
  if (!guarded.ok) return guarded
  const res = await runUpdateIdentity(drizzleIdentityWrite, {
    ...(typeof input === 'object' && input !== null ? input : {}),
    restaurantId: guarded.restaurantId,
  })
  if ('error' in res) return { ok: false, error: res.error }
  revalidatePath(`/dashboard/r/${slug}`)
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
  return { ok: true }
}

/**
 * Rename the public URL slug. The action returns the new slug on
 * success so the client can `router.replace(/dashboard/r/<new>)` —
 * the old dashboard URL would 404 on next render because the
 * `requireRestaurantBySlug` guard no longer finds the row.
 *
 * Cache invalidation: both old and new slug-tag snapshots are
 * invalidated. The old slug's public-menu cache is now orphaned (no
 * row resolves to it); the next request to `/r/<old>` is a 404. The
 * new slug's cache is empty until the next public render rebuilds it.
 */
export async function updateSlug(
  currentSlug: string,
  nextSlug: unknown,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const guarded = await gateIdentity(currentSlug)
  if (!guarded.ok) return guarded
  // The actual slug write lives in the restaurant-slug slice — this
  // action just gates by tenant ownership, then delegates and routes
  // cache invalidation.
  const res = await runRenameSlug(
    guarded.restaurantId,
    typeof nextSlug === 'string' ? nextSlug : '',
  )
  if (!res.ok) return { ok: false, error: res.message }

  // Invalidate BOTH tags — old slug's snapshot is now orphaned, new
  // slug has none yet. `revalidatePath` covers dashboard surfaces;
  // `revalidateRestaurant` covers the public menu's cache-tag.
  revalidatePath(`/dashboard/r/${currentSlug}`)
  revalidatePath(`/dashboard/r/${currentSlug}/theme`)
  revalidatePath(`/dashboard/r/${res.slug}`)
  revalidatePath(`/dashboard/r/${res.slug}/theme`)
  revalidateRestaurant(currentSlug)
  revalidateRestaurant(res.slug)

  return { ok: true, slug: res.slug }
}
