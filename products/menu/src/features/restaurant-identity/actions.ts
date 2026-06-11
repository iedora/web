'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ApiError } from '@iedora/api-client'
import * as api from '../../shared/api'
import { LANGUAGE_CODES, type LanguageCode } from '../i18n'
import { localizedSchema, pruneLocalized } from '../i18n/server'
import { revalidateRestaurant } from '../menu-publishing'
import { FONTS, HEX_PATTERN, LAYOUTS } from '../menu-publishing/rsc/theme'
import { isValidSlugShape } from '../restaurant-slug'

/**
 * Server action shells — thin wrappers over the Go menu API's identity
 * PATCH. The Go service owns authorization (Bearer token + slug scope),
 * persistence and the default-language promotion; the zod parses here
 * only keep garbage out of the wire format so the editor gets a
 * friendly message instead of a generic 400.
 *
 * Every mutation that affects the public menu calls
 * `revalidateRestaurant` (AGENTS.md hard rule #12); path-based
 * revalidation on the dashboard side is kept as a belt-and-suspenders
 * guard until tag-only invalidation is fully rolled out.
 */

type ActionResult = { ok: true } | { ok: false; error: string }

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong'
}

function revalidateIdentityPages(slug: string) {
  revalidatePath(`/menu/dashboard/r/${slug}`)
  revalidatePath(`/menu/dashboard/r/${slug}/theme`)
  revalidateRestaurant(slug)
}

// LAYOUTS comes from the templates registry (AGENTS.md hard rule #8) — the
// enum here is derived at module load, so adding a template just shows up.
const ThemeInput = z.object({
  layout: z.enum(LAYOUTS.map((l) => l.id) as [string, ...string[]]),
  font: z.enum(FONTS.map((f) => f.id) as [string, ...string[]]),
  primaryColor: z.string().regex(HEX_PATTERN, 'Must be a #RRGGBB hex color'),
  secondaryColor: z.string().regex(HEX_PATTERN, 'Must be a #RRGGBB hex color'),
})

export async function updateTheme(slug: string, input: unknown): Promise<ActionResult> {
  const parsed = ThemeInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid theme' }
  }
  try {
    await api.updateIdentity(slug, { theme: parsed.data })
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidateIdentityPages(slug)
  return { ok: true }
}

// defaultLanguage MUST be in supportedLanguages so the fallback chain
// always has something to land on. The Go service performs the
// promote-on-switch rotation (source column ↔ i18n slot) when the
// default changes.
const LanguageInput = z
  .object({
    defaultLanguage: z.enum(LANGUAGE_CODES as unknown as [LanguageCode, ...LanguageCode[]]),
    supportedLanguages: z
      .array(z.enum(LANGUAGE_CODES as unknown as [LanguageCode, ...LanguageCode[]]))
      .min(1, 'Pick at least one language'),
  })
  .refine((d) => d.supportedLanguages.includes(d.defaultLanguage), {
    message: 'Default language must be in the supported set',
    path: ['defaultLanguage'],
  })

export async function updateLanguageSettings(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = LanguageInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid language settings',
    }
  }
  try {
    await api.updateIdentity(slug, {
      defaultLanguage: parsed.data.defaultLanguage,
      // Dedupe + keep declarative order from input.
      supportedLanguages: Array.from(new Set(parsed.data.supportedLanguages)),
    })
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidateIdentityPages(slug)
  return { ok: true }
}

// Empty strings collapse to undefined so the row doesn't carry "" values
// that the renderer would treat as truthy and try to render. Logo/banner
// are managed by the ImageUpload component (features/upload/actions).
const IdentityInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? undefined : v)),
  descriptionI18n: localizedSchema,
})

export async function updateIdentity(slug: string, input: unknown): Promise<ActionResult> {
  const parsed = IdentityInput.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  try {
    await api.updateIdentity(slug, {
      name: parsed.data.name,
      description: parsed.data.description,
      descriptionI18n: pruneLocalized(parsed.data.descriptionI18n) ?? undefined,
    })
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidateIdentityPages(slug)
  return { ok: true }
}

/**
 * Rename the public URL slug. The Go service validates the shape and
 * 409s when the slug is taken. The action returns the new slug on
 * success so the client can `router.replace(/dashboard/r/<new>)` —
 * the old dashboard URL would 404 on next render because the slug no
 * longer resolves.
 */
export async function updateSlug(
  currentSlug: string,
  nextSlug: unknown,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const next = typeof nextSlug === 'string' ? nextSlug.trim().toLowerCase() : ''
  if (!isValidSlugShape(next)) {
    return { ok: false, error: 'Use 2–40 lowercase letters, numbers, and hyphens.' }
  }
  try {
    await api.renameSlug(currentSlug, next)
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { ok: false, error: 'That URL is already taken.' }
    }
    return { ok: false, error: errorMessage(err) }
  }

  // Invalidate BOTH slugs — the old one's snapshot is now orphaned, the
  // new one has none yet.
  revalidateIdentityPages(currentSlug)
  revalidateIdentityPages(next)

  return { ok: true, slug: next }
}
