'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantBySlug } from '@/features/auth'
import { revalidateRestaurant } from '@/features/menu-publishing'
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

export async function updateTheme(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateTheme(drizzleIdentityWrite, {
    ...(typeof input === 'object' && input !== null ? input : {}),
    restaurantId: r.id,
  })
  if ('error' in res) return { ok: false, error: res.error }
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
  return { ok: true }
}

export async function updateLanguageSettings(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateLanguageSettings(drizzleIdentityWrite, {
    ...(typeof input === 'object' && input !== null ? input : {}),
    restaurantId: r.id,
  })
  if ('error' in res) return { ok: false, error: res.error }
  revalidatePath(`/dashboard/r/${slug}`)
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
  return { ok: true }
}

export async function updateIdentity(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const { restaurant: r } = await requireRestaurantBySlug(slug)
  const res = await runUpdateIdentity(drizzleIdentityWrite, {
    ...(typeof input === 'object' && input !== null ? input : {}),
    restaurantId: r.id,
  })
  if ('error' in res) return { ok: false, error: res.error }
  revalidatePath(`/dashboard/r/${slug}`)
  revalidatePath(`/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
  return { ok: true }
}
