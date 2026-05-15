import 'server-only'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { revalidateRestaurant } from '@/features/menu-publishing'
import { db } from '@/shared/db/client'
import { item, restaurant } from '@/shared/db/schema'
import type { AssetTarget } from '../types'
import type { Storage } from '../types'

const targetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('restaurant-logo'),
    restaurantId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('restaurant-banner'),
    restaurantId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('item-photo'),
    restaurantId: z.string().min(1),
    itemId: z.string().min(1),
  }),
])

const inputSchema = z.object({
  target: targetSchema,
  key: z.string().min(1),
  publicUrl: z.string().url(),
})

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Persist a freshly uploaded asset's public URL on the owning row and
 * best-effort delete any previous object.
 *
 * Pre-condition: the shell MUST have already called `requireRestaurantAccess`
 * for `input.target.restaurantId`. This use-case re-validates the key prefix
 * (`r/{restaurantId}/...`) as defense-in-depth — a stale presign cannot be
 * redirected to a different tenant.
 */
export async function commitAsset(
  deps: { storage: Storage },
  raw: unknown,
): Promise<Result<{ url: string }>> {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { target, key, publicUrl } = parsed.data

  assertKeyBelongsToTarget(key, target)

  const previousUrl = await readCurrentAssetUrl(target)

  await writeAssetUrl(target, publicUrl)
  await bustPaths(target)

  if (previousUrl) {
    const previousKey = deps.storage.keyFromPublicUrl(previousUrl)
    if (previousKey && previousKey !== key) {
      await deps.storage.delete(previousKey)
    }
  }

  return { ok: true, data: { url: publicUrl } }
}

// ─── Internal helpers (shared with clear-asset via re-export below) ─────────

export function assertKeyBelongsToTarget(key: string, target: AssetTarget): void {
  // The buildKey scheme always starts with `r/${restaurantId}/`. Any key that
  // doesn't, or that points to a different restaurant, is rejected.
  const expectedPrefix = `r/${target.restaurantId}/`
  if (!key.startsWith(expectedPrefix)) {
    throw new Error('Key does not belong to the target restaurant')
  }
}

export async function readCurrentAssetUrl(target: AssetTarget): Promise<string | null> {
  switch (target.kind) {
    case 'restaurant-logo': {
      const rows = await db
        .select({ url: restaurant.logoUrl })
        .from(restaurant)
        .where(eq(restaurant.id, target.restaurantId))
        .limit(1)
      return rows[0]?.url ?? null
    }
    case 'restaurant-banner': {
      const rows = await db
        .select({ url: restaurant.bannerUrl })
        .from(restaurant)
        .where(eq(restaurant.id, target.restaurantId))
        .limit(1)
      return rows[0]?.url ?? null
    }
    case 'item-photo': {
      const rows = await db
        .select({ url: item.imageUrl })
        .from(item)
        .where(eq(item.id, target.itemId))
        .limit(1)
      return rows[0]?.url ?? null
    }
  }
}

export async function writeAssetUrl(
  target: AssetTarget,
  url: string | null,
): Promise<void> {
  switch (target.kind) {
    case 'restaurant-logo':
      await db
        .update(restaurant)
        .set({ logoUrl: url })
        .where(eq(restaurant.id, target.restaurantId))
      return
    case 'restaurant-banner':
      await db
        .update(restaurant)
        .set({ bannerUrl: url })
        .where(eq(restaurant.id, target.restaurantId))
      return
    case 'item-photo':
      await db
        .update(item)
        .set({ imageUrl: url })
        .where(and(eq(item.id, target.itemId), eq(item.restaurantId, target.restaurantId)))
      return
  }
}

export async function bustPaths(target: AssetTarget): Promise<void> {
  // Slug isn't on the target — read it once so we can revalidate /r/[slug].
  const rows = await db
    .select({ slug: restaurant.slug })
    .from(restaurant)
    .where(eq(restaurant.id, target.restaurantId))
    .limit(1)
  const slug = rows[0]?.slug
  if (!slug) return
  revalidatePath(`/dashboard/r/${slug}`)
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
}
