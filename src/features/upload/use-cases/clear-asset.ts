import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/shared/db/client'
import { item } from '@/shared/db/schema'
import type { Storage } from '../types'
import { bustPaths, readCurrentAssetUrl, writeAssetUrl } from './commit-asset'

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

const inputSchema = z.object({ target: targetSchema })

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Clear the asset URL on the owning row and delete the underlying object.
 *
 * Pre-condition: the shell MUST have already called `requireRestaurantAccess`
 * for `input.target.restaurantId`. Item-photo targets get an extra ownership
 * check here so a stale itemId cannot leak deletion onto a different
 * restaurant's row.
 */
export async function clearAsset(
  deps: { storage: Storage },
  raw: unknown,
): Promise<Result<null>> {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { target } = parsed.data

  if (target.kind === 'item-photo') {
    await assertItemBelongsToRestaurant(target.itemId, target.restaurantId)
  }

  const previousUrl = await readCurrentAssetUrl(target)
  await writeAssetUrl(target, null)
  await bustPaths(target)

  if (previousUrl) {
    const previousKey = deps.storage.keyFromPublicUrl(previousUrl)
    if (previousKey) await deps.storage.delete(previousKey)
  }

  return { ok: true, data: null }
}

async function assertItemBelongsToRestaurant(
  itemId: string,
  restaurantId: string,
): Promise<void> {
  const rows = await db
    .select({ id: item.id })
    .from(item)
    .where(and(eq(item.id, itemId), eq(item.restaurantId, restaurantId)))
    .limit(1)
  if (rows.length === 0) {
    throw new Error('Item does not belong to the restaurant')
  }
}
