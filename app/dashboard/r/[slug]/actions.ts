'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, max } from 'drizzle-orm'
import { z } from 'zod'
import { requireRestaurantBySlug } from '@/lib/dal'
import { db } from '@/lib/db'
import { menu } from '@/lib/db/schema'

const createMenuSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export async function createMenu(slug: string, formData: FormData) {
  const parsed = createMenuSchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid name' }
  }

  const { restaurant: r } = await requireRestaurantBySlug(slug)

  const [{ next }] = await db
    .select({ next: max(menu.position) })
    .from(menu)
    .where(eq(menu.restaurantId, r.id))

  await db.insert(menu).values({
    restaurantId: r.id,
    name: parsed.data.name,
    position: (next ?? -1) + 1,
  })

  revalidatePath(`/dashboard/r/${slug}`)
  return { ok: true as const }
}

export async function deleteMenu(slug: string, menuId: string) {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  await db.delete(menu).where(and(eq(menu.id, menuId), eq(menu.restaurantId, r.id)))
  revalidatePath(`/dashboard/r/${slug}`)
}
