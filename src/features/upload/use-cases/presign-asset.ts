import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/shared/db/client'
import { item } from '@/shared/db/schema'
import { TARGET_CONSTRAINTS, buildKey } from '../targets'
import type { PresignedUpload, Storage } from '../types'

// Mirror the action's discriminated union for defense-in-depth re-validation.
// The shell parses first; the use-case re-parses so a misconfigured caller
// (or a future direct importer) can't bypass it.
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
  contentType: z.string().min(1),
  contentLengthBytes: z.number().int().positive(),
})

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Presign a browser PUT URL for an uploadable asset.
 *
 * Pre-condition: the shell MUST have already called `requireRestaurantAccess`
 * for `input.target.restaurantId`. This use-case enforces target constraints
 * (mime, size), validates item ownership for `item-photo`, builds a
 * tenant-prefixed key (`r/{restaurantId}/...`), and asks the storage port
 * for a presigned PUT.
 */
export async function presignAsset(
  deps: { storage: Storage },
  raw: unknown,
): Promise<Result<PresignedUpload>> {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { target, contentType, contentLengthBytes } = parsed.data

  const constraints = TARGET_CONSTRAINTS[target.kind]
  if (!constraints.acceptedMimeTypes.includes(contentType)) {
    return {
      ok: false,
      error: `Unsupported file type. Allowed: ${constraints.acceptedMimeTypes.join(', ')}`,
    }
  }
  if (contentLengthBytes > constraints.maxBytes) {
    return {
      ok: false,
      error: `File too large. Max ${(constraints.maxBytes / (1024 * 1024)).toFixed(0)} MB.`,
    }
  }

  if (target.kind === 'item-photo') {
    await assertItemBelongsToRestaurant(target.itemId, target.restaurantId)
  }

  const key = buildKey(target, contentType)
  const upload = await deps.storage.presignPut(key, {
    contentType,
    contentLengthBytes,
  })
  return { ok: true, data: upload }
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
