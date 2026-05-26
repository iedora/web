'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantBySlug } from '@/features/auth'
import type { LanguageCode } from '@/features/i18n'
import { revalidateRestaurant } from '@/features/menu-publishing'
import {
  canGenerateAiMenu,
  recordAiGeneration,
} from '@/features/plans'
import type {
  ParsedCategory,
  ParseMenuErrorCode,
  PatchCurrentMenu,
  PatchOperation,
} from './ports'
import { menuAnalysisAdapter } from './adapters/ai'
import { drizzleMenuImport } from './adapters/drizzle'
import { parseMenuImage as runParseMenuImage } from './use-cases/parse-menu-image'
import { importParsedMenu as runImportParsedMenu } from './use-cases/import-parsed-menu'
import { applyMenuPatch as runApplyMenuPatch } from './use-cases/apply-menu-patch'

/**
 * Server action shells — auth guard → quota gate → use-case → (revalidate).
 *
 * `analyzeMenuImage` calls Gemini against a rolling-7d quota per plan
 * (Free 1, Casa 5). It does NOT persist a menu — that happens in
 * `importMenuFromParsed`.
 */

export type AnalyzeResult =
  | {
      categories: ParsedCategory[]
      language: LanguageCode
      currency: string
      quota: { used: number; limit: number }
    }
  | { error: string; code: ParseMenuErrorCode }
  | {
      error: string
      reason: 'ai-weekly-limit'
      limit: number
      used: number
      resetAt: string
    }

/**
 * Step 1 — AI analysis.
 * Calls Gemini with the uploaded image URL and returns the parsed
 * categories alongside detected language + currency. Charges one slot
 * against the org's weekly AI quota only when the Gemini call succeeds —
 * a failed parse leaves the counter untouched so the operator can retry
 * with a better photo.
 */
export async function analyzeMenuImage(
  slug: string,
  imageUrl: string,
): Promise<AnalyzeResult> {
  // Auth guard: verifies the caller belongs to the restaurant's org.
  const { organizationId } = await requireRestaurantBySlug(slug)

  const gate = await canGenerateAiMenu(organizationId)
  if (!gate.ok) {
    return {
      error: `Weekly AI menu limit reached (${gate.used}/${gate.limit}). Upgrade to Casa for 5 imports per week.`,
      reason: 'ai-weekly-limit',
      limit: gate.limit,
      used: gate.used,
      resetAt: gate.resetAt.toISOString(),
    }
  }

  const result = await runParseMenuImage(menuAnalysisAdapter, { imageUrl })
  if ('error' in result) return result

  await recordAiGeneration(organizationId)

  return {
    categories: result.categories,
    language: result.language,
    currency: result.currency,
    quota: { used: gate.used + 1, limit: gate.limit },
  }
}

/**
 * Step 2 — Persist.
 * Creates a new menu from the (optionally edited) parsed categories.
 * Invalidates the public menu cache so guests see the new menu immediately.
 *
 * `options.setDefaultLanguage` is the opt-in for the onboarding flow:
 * pass the detected language and the restaurant's `default_language`
 * column gets rewritten so the public menu renders in the matching
 * tongue without a separate Settings round-trip. The dialog wrapper on
 * the per-restaurant page doesn't pass it — existing restaurants keep
 * whatever language the operator has already chosen.
 */
export async function importMenuFromParsed(
  slug: string,
  menuName: string,
  categories: ParsedCategory[],
  options?: { setDefaultLanguage?: LanguageCode },
): Promise<{ ok: true; menuId: string } | { error: string }> {
  const { restaurant: r } = await requireRestaurantBySlug(slug)

  const res = await runImportParsedMenu(drizzleMenuImport, {
    restaurantId: r.id,
    menuName,
    categories,
  })

  if ('ok' in res && options?.setDefaultLanguage) {
    await drizzleMenuImport.setRestaurantDefaultLanguage(
      r.id,
      options.setDefaultLanguage,
    )
  }

  if ('ok' in res) {
    revalidatePath(`/dashboard/r/${slug}`)
    revalidateRestaurant(slug)
  }

  return res
}

// ── PATCH flow ────────────────────────────────────────────────────────────

export type AnalyzePatchResult =
  | {
      operations: PatchOperation[]
      language: import('@/features/i18n').LanguageCode
      currency: string
      quota: { used: number; limit: number }
    }
  | { error: string; code: ParseMenuErrorCode }
  | {
      error: string
      reason: 'ai-weekly-limit'
      limit: number
      used: number
      resetAt: string
    }

/**
 * PATCH step 1 — hand the AI the current menu + a fresh photo, get
 * back a list of operations. Token-efficient: nothing already on the
 * plate is echoed back. Charges one slot against the org's weekly
 * AI quota.
 */
export async function analyzeMenuPatch(
  slug: string,
  imageUrl: string,
  current: PatchCurrentMenu,
): Promise<AnalyzePatchResult> {
  const { organizationId } = await requireRestaurantBySlug(slug)

  const gate = await canGenerateAiMenu(organizationId)
  if (!gate.ok) {
    return {
      error: `Weekly AI menu limit reached (${gate.used}/${gate.limit}). Upgrade to Casa for 5 imports per week.`,
      reason: 'ai-weekly-limit',
      limit: gate.limit,
      used: gate.used,
      resetAt: gate.resetAt.toISOString(),
    }
  }

  const result = await menuAnalysisAdapter.parseMenuPatch({
    imageUrl,
    current,
  })
  if ('error' in result) return result

  await recordAiGeneration(organizationId)

  return {
    operations: result.operations,
    language: result.language,
    currency: result.currency,
    quota: { used: gate.used + 1, limit: gate.limit },
  }
}

/**
 * PATCH step 2 — apply the (optionally edited) operations to the
 * existing menu. Operator can drop ops in the preview before
 * confirming, so what we receive is the subset they want applied.
 */
export async function applyMenuPatchAction(
  slug: string,
  menuId: string,
  operations: PatchOperation[],
): Promise<{ ok: true; stats: { addedItems: number; updatedItems: number; removedItems: number; addedCategories: number; removedCategories: number; renamedCategories: number } } | { error: string }> {
  const { restaurant: r } = await requireRestaurantBySlug(slug)

  const res = await runApplyMenuPatch(drizzleMenuImport, {
    restaurantId: r.id,
    menuId,
    operations,
  })

  if ('ok' in res) {
    revalidatePath(`/dashboard/r/${slug}`)
    revalidateRestaurant(slug)
  }

  return res
}
