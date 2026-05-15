'use server'

import { z } from 'zod'
import { requireRestaurantAccess } from '@/features/auth'
import { getStorage } from './adapters/factory'
import { clearAsset as runClearAsset } from './use-cases/clear-asset'
import { commitAsset as runCommitAsset } from './use-cases/commit-asset'
import { presignAsset as runPresignAsset } from './use-cases/presign-asset'
import type { PresignedUpload } from './types'

/**
 * Server action shells — authenticate the caller, then delegate to the
 * use-case with the production storage adapter. Keep these thin so the
 * testable surface stays in `./use-cases/*`.
 *
 * AGENTS.md hard rule #9: `requireRestaurantAccess` runs first, then the
 * use-case re-validates the key (`assertKeyBelongsToTarget`) as
 * defense-in-depth against a stale presign being redirected.
 */

// Minimal upfront parse so we can pull `restaurantId` out before calling the
// auth guard. The use-case re-parses with the full schema.
const restaurantIdShape = z.object({
  target: z.object({ restaurantId: z.string().min(1) }).passthrough(),
})

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function pickRestaurantId(raw: unknown): string | null {
  const parsed = restaurantIdShape.safeParse(raw)
  return parsed.success ? parsed.data.target.restaurantId : null
}

export async function requestUploadUrl(
  input: unknown,
): Promise<Result<PresignedUpload>> {
  const restaurantId = pickRestaurantId(input)
  if (!restaurantId) return { ok: false, error: 'Invalid input' }
  await requireRestaurantAccess(restaurantId)
  const storage = await getStorage()
  return runPresignAsset({ storage }, input)
}

export async function commitAsset(input: unknown): Promise<Result<{ url: string }>> {
  const restaurantId = pickRestaurantId(input)
  if (!restaurantId) return { ok: false, error: 'Invalid input' }
  await requireRestaurantAccess(restaurantId)
  const storage = await getStorage()
  return runCommitAsset({ storage }, input)
}

export async function clearAsset(input: unknown): Promise<Result<null>> {
  const restaurantId = pickRestaurantId(input)
  if (!restaurantId) return { ok: false, error: 'Invalid input' }
  await requireRestaurantAccess(restaurantId)
  const storage = await getStorage()
  return runClearAsset({ storage }, input)
}
