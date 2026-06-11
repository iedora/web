import 'server-only'
import { revalidatePath } from 'next/cache'

/**
 * Invalidation chokepoint for the public menu page. The data itself
 * now lives in the Go menu service and every read is `no-store`, so
 * there is no tag-based snapshot cache left to purge — what remains
 * is the Next router/RSC payload cache for the public route, which
 * `revalidatePath` refreshes after a mutation.
 */
export function revalidateRestaurant(slug: string): void {
  revalidatePath(`/menu/r/${slug}`)
}
