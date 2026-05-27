/**
 * Provider-agnostic helpers for the menu-import AI flow. Every concrete
 * adapter file (`ai-kimi.ts`, future `ai-openai.ts`, `ai-claude.ts`, …)
 * imports from here so the schema, prompt, mapping, error classification,
 * and image fetcher stay in lockstep across providers.
 *
 * Provider-specific bits — base URL, model name, max output tokens,
 * any vendor request quirks — live in the per-provider file. That file
 * implements `ImageAnalysisPort` from `../ports`; consumers depend on the
 * port, not on any specific provider (strategy pattern, dependency
 * inversion).
 *
 * Tests live next to this file (`ai-shared.test.ts`) for the cross-
 * provider concerns, and next to each provider file for its specifics.
 */
import 'server-only'
import { z } from 'zod'
import type { ParseMenuErrorCode, ParseMenuResult } from '../ports'

// ── Schema ────────────────────────────────────────────────────────────────

// Keep in sync with `LANGUAGE_CODES` in `@/features/i18n/registry`. The
// model's schema needs literal values (z.enum can't take a runtime
// `readonly string[]`); adding a language to the registry means adding it
// here too.
const LanguageAISchema = z
  .enum(['en', 'pt', 'es', 'fr'])
  .describe(
    'ISO 639-1 language code matching the language the menu is written in. ' +
      "Use 'en' as the fallback when the menu's language isn't one of these.",
  )

// Every nice-to-have field has a `.default()` so the model can skip it
// without hard-failing the import. LLMs routinely drop fields they
// consider redundant or self-evident (a clean €12.50 price doesn't need
// confidence=1.0 spelled out, in their eyes). The defaults let us
// degrade gracefully. Required: `name`. Everything else has a fallback.
//
// `available` is deliberately NOT on this schema — items always import
// as available; the operator manages availability later via the menu
// builder. A €0 price means "free", not "unavailable".
const ParsedVariantAISchema = z.object({
  label: z
    .string()
    .describe(
      'Variant label as written on the menu (e.g. "Meia dose", "Imperial", ' +
        '"Jarra 1L"). Keep the original language.',
    ),
  priceCents: z
    .number()
    .int()
    .min(0)
    .describe('Price for this variant in integer cents.'),
})

const ParsedItemAISchema = z.object({
  name: z.string().describe('Name of the dish or drink exactly as written on the menu'),
  description: z
    .string()
    .optional()
    .describe('Short description of the dish, if present on the menu'),
  priceCents: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'Primary / leftmost price for this dish in integer cents (e.g. €12.50 ' +
        '→ 1250). Use 0 if no price is visible.',
    ),
  variants: z
    .array(ParsedVariantAISchema)
    .optional()
    .describe(
      'Alternate prices for the same dish (e.g. half-dose, small/large, ' +
        'beer sizes, wine pours). Use this whenever the menu lists more ' +
        'than one price for a single named dish. Omit entirely when there ' +
        "'s just one price.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe(
      'Your confidence in this row, 0 to 1. Drop below 0.7 when the photo ' +
        'is blurry around this item, when OCR was ambiguous, or when you had ' +
        "to guess at the price. Use 1.0 only when you're certain.",
    ),
})

const ParsedCategoryAISchema = z.object({
  name: z.string().describe('Category or section name (e.g. "Starters", "Main Courses")'),
  items: z.array(ParsedItemAISchema),
})

export const MenuOutputSchema = z.object({
  language: LanguageAISchema,
  currency: z
    .string()
    .default('')
    .describe(
      "ISO 4217 currency code matching the menu's prices (e.g. 'EUR', 'USD', " +
        "'GBP'). Empty string when no currency symbol is visible.",
    ),
  categories: z
    .array(ParsedCategoryAISchema)
    .default([])
    .describe('All categories extracted from the menu image, in order of appearance'),
})

export type MenuOutput = z.infer<typeof MenuOutputSchema>

// ── PATCH-mode schema ─────────────────────────────────────────────────────

/**
 * Token-efficient diff format. The AI sees the current menu + a fresh
 * photo and returns ONLY the operations needed to bring the menu in
 * line with the photo. Items that are unchanged don't appear anywhere.
 */
const PatchOperationAISchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add-category'),
    name: z.string().describe('Name of the new category as printed on the menu.'),
    items: z
      .array(
        z.object({
          name: z.string(),
          priceCents: z.number().int().min(0).default(0),
          description: z.string().optional(),
        }),
      )
      .default([]),
  }),
  z.object({
    kind: z.literal('remove-category'),
    categoryId: z.string().describe('id of an existing category to drop.'),
  }),
  z.object({
    kind: z.literal('rename-category'),
    categoryId: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal('add-item'),
    categoryId: z
      .string()
      .nullable()
      .describe(
        'id of the existing category this item belongs to. Pass null and ' +
          'set `categoryName` when the parent is a category you just added ' +
          'in an `add-category` op.',
      ),
    categoryName: z.string().optional(),
    name: z.string(),
    priceCents: z.number().int().min(0).default(0),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('update-item'),
    itemId: z.string().describe('id of an existing item to modify.'),
    name: z.string().optional(),
    priceCents: z.number().int().min(0).optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('remove-item'),
    itemId: z.string().describe('id of an existing item to drop.'),
  }),
])

export const MenuPatchSchema = z.object({
  language: LanguageAISchema,
  currency: z.string().default(''),
  operations: z.array(PatchOperationAISchema).default([]),
})

export type MenuPatchOutput = z.infer<typeof MenuPatchSchema>

export const PATCH_SYSTEM_PROMPT = `You are a menu update assistant.
The user shows you a restaurant's CURRENT menu (as JSON) and a fresh
photo of the same menu. Your job is to return ONLY the operations
needed to bring the stored menu in line with the photo.

Output a single \`operations\` array. Empty array means "no changes".

OP KINDS:
- "add-category" — a brand-new section visible in the photo. Include
  its items inline (with name + priceCents).
- "remove-category" — a section that's gone from the photo. Reference
  by the \`id\` from the input JSON. Items cascade automatically.
- "rename-category" — same section, different printed name.
- "add-item" — a new dish. If its parent category EXISTS in the input
  JSON, set \`categoryId\` to that id and omit \`categoryName\`. If the
  parent is itself a NEW category (you also emitted an "add-category"
  op for it), set \`categoryId\` to null and \`categoryName\` to the
  new category's name.
- "update-item" — same dish, different name / price / description.
  Reference by the \`id\` from the input JSON. ONLY include the fields
  that changed. Do not echo the unchanged fields.
- "remove-item" — a dish that's gone from the photo. Reference by id.

RULES:
- TOKEN ECONOMY — items whose name, price, and description match the
  photo MUST NOT appear in the output. Don't echo unchanged data.
- IDENTITY — match items by name (case-insensitive, accent-insensitive,
  ignoring trailing punctuation). A minor wording change ("Polvo à
  lagareiro" → "Polvo à lagareiro grelhado") is an "update-item" on
  the same id, not a remove + add.
- PRICE PARSING — €12.50 → priceCents 1250. €0,00 or no symbol → 0.
- LANGUAGE / CURRENCY — return the menu's detected language and
  currency the same way as the full-import flow (single language in
  names/descriptions, ISO 4217 currency code).
- IF THE PHOTO ISN'T A MENU — return \`operations: []\`. Do not invent.
- IF THE PHOTO IS THE SAME MENU UNCHANGED — return \`operations: []\`.
  This is a valid, common outcome.`

// ── Prompt ────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a menu-digitisation assistant.
The user will provide a photo of a restaurant menu (physical or digital).
Your job is to extract ALL visible categories and menu items from the image,
plus the menu's language and currency.

Rules:
- Detect the menu's language and return it as the ISO 639-1 code ('en', 'pt',
  'es', or 'fr'). Use 'en' as the fallback when the menu is in a language
  outside this set.
- Detect the currency from the visible price symbol and return the ISO 4217
  code ('EUR' for €, 'USD' for $, 'GBP' for £, etc.). Return an empty string
  when no currency symbol is visible.
- TRANSLATION-READY OUTPUT — the extracted menu will be machine-translated
  into other languages downstream, so the source text must be clean:
  * Every \`name\` and \`description\` must be in EXACTLY ONE language —
    the menu's source language (the same code you return in \`language\`).
    Do NOT mix English glosses into a Portuguese name. Do NOT append
    "(salt cod)" after "Bacalhau". If the menu itself prints a
    translation next to the original (rare), keep ONLY the source.
  * Use the menu's wording verbatim. Do NOT paraphrase, expand
    abbreviations, or substitute synonyms. "Café (Bica)" stays as-is.
  * Strip pricing fragments and variant labels from names — those live
    on \`priceCents\` and \`variants\`, never duplicated into \`name\`.
    E.g. a menu showing "Bacalhau à brás · 14,50 / 8,00" yields
    \`name = "Bacalhau à brás"\`, never "Bacalhau à brás 14,50 / 8,00".
  * Drop noise that wouldn't survive translation: stars/stickers,
    seasonal hand-scribbled tags ("HOJE!"), index numbers ("01.",
    "12)") before names. Keep printed allergen markers ("(v)", "(gf)")
    only when they're part of the original copy and inside descriptions.
  * Correct only OBVIOUS OCR errors (transposed letters, dropped
    accents). Do not "improve" capitalisation or punctuation.
- Convert prices to integer cents (€12.50 → 1250, $8 → 800). Use 0 when no
  price is visible.
- VARIANT PRICES — read carefully. Many Portuguese menus put column headers
  like "PREÇO / DOSE" and "PREÇO 1/2 DOSE" (or "DOSE / MEIA DOSE",
  "S / L", "33cl / 50cl") above an aligned grid of prices. EVERY row in
  that grid is a single dish with MULTIPLE prices, one per column header.
  When you see a column-header layout:
    * Read the leftmost column as the dish's primary price (\`priceCents\`).
    * For each remaining column whose row has a price, add a \`variants\`
      entry with \`label\` = the column header (e.g. "Meia dose", "1/2 Dose",
      "Large"), and \`priceCents\` = that column's value for the row.
    * The column header is NOT a category. DO NOT emit "PREÇO / DOSE" or
      "1/2 Dose" as a category name. The category is the section title
      ABOVE the grid (e.g. "PRATOS PRINCIPAIS").
    * Each dish appears exactly once. DO NOT duplicate "Bacalhau à brás"
      to capture its half-dose price.
  Worked example for a dual-column mains section:
    PRATOS PRINCIPAIS    PREÇO / DOSE    PREÇO 1/2 DOSE
    Bacalhau à Brás       € 14,50         € 8,00
    Polvo à Lagareiro     € 19,00         € 7,50
  → category "PRATOS PRINCIPAIS" with two items, each carrying one variant:
    Bacalhau à Brás: priceCents 1450, variants [{ label: "Meia dose", priceCents: 800 }]
    Polvo à Lagareiro: priceCents 1900, variants [{ label: "Meia dose", priceCents: 750 }]
  Inline variants (one row says "Imperial €1,60 / Caneca €2,80") follow the
  same rule: leftmost is primary, every other goes into \`variants\` with
  its label.
- Omit \`variants\` entirely when the dish has only one price.
- Set confidence per item: 1.0 when you're certain, lower when OCR was
  ambiguous or you had to guess. Drop below 0.7 for hard-to-read rows so the
  operator can review them.
- If you see a category without items listed, include it with an empty items
  array.
- Do not invent items or prices that are not visible in the image.
- If the image is not a menu, return an empty categories array.`

export const USER_PROMPT = 'Extract all menu categories and items from this image.'

// ── Response mapping ──────────────────────────────────────────────────────

/**
 * Provider-agnostic response mapper. Takes the validated model output
 * (whatever provider produced it) and produces the slice's `ParsedMenu`.
 * Stamps `available: true` on every item — `available` is not a field
 * we extract; it's the operator's call after import.
 */
export function mapAIResponseToParsedMenu(
  object: MenuOutput,
): Extract<ParseMenuResult, { language: unknown }> {
  return {
    language: object.language,
    currency: object.currency,
    categories: object.categories.map((category) => ({
      name: category.name,
      items: category.items.map((item) => ({
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        available: true,
        confidence: item.confidence,
        // Drop the variants property entirely when the AI didn't return
        // any — keeps the parsed shape free of `variants: undefined`
        // noise downstream.
        ...(item.variants && item.variants.length > 0
          ? { variants: item.variants }
          : {}),
      })),
    })),
  }
}

// ── Error classification ──────────────────────────────────────────────────

/**
 * Inspects an SDK error message and groups it into one of the coarse
 * buckets the UI knows about. We deliberately match strings rather than
 * vendor-specific error classes — Kimi, OpenAI, Gemini, Claude all
 * surface the same patterns ("rate limit", "quota", "credits") and we
 * want the same friendly copy regardless of who's behind the curtain.
 */
export function classifyError(err: unknown): ParseMenuErrorCode {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  // Truncation fingerprint — JSON output cut off mid-string. The model
  // hit its `maxOutputTokens` cap before closing the response. Distinct
  // from a "blurry photo" parse failure because the AI did read the image,
  // it just ran out of room to write the result.
  if (
    message.includes('unterminated string') ||
    message.includes('unterminated') ||
    message.includes('unexpected end of') ||
    message.includes('truncated')
  ) {
    return 'truncated'
  }
  if (
    message.includes('credit') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('rate-limit') ||
    message.includes('billing') ||
    message.includes('429')
  ) {
    return 'quota'
  }
  if (
    message.includes('api key') ||
    message.includes('apikey') ||
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('forbidden') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return 'auth'
  }
  if (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('fetch failed')
  ) {
    return 'network'
  }
  if (
    message.includes('schema') ||
    message.includes('validation') ||
    message.includes('parse') ||
    message.includes('invalid response')
  ) {
    return 'parse'
  }
  return 'unknown'
}

// ── Image fetcher ─────────────────────────────────────────────────────────

/**
 * Fetches the just-uploaded image from our S3 bucket and hands the model
 * raw bytes. Provider-agnostic — every adapter calls this before the AI
 * request. We deliberately avoid passing the URL: in dev the bucket lives
 * on `localhost` (S3 mock) which the AI provider can't reach, and
 * in prod the public URL would force a provider → R2 round-trip slower
 * than a same-region server-side fetch + inline bytes.
 */
export async function fetchImageBytes(
  imageUrl: string,
): Promise<
  | { bytes: Uint8Array; mediaType: string }
  | { error: string; code: ParseMenuErrorCode }
> {
  let res: Response
  try {
    res = await fetch(imageUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      error: `Could not download the uploaded image (${message}).`,
      code: 'network',
    }
  }
  if (!res.ok) {
    return {
      error: `Could not download the uploaded image (HTTP ${res.status}).`,
      code: 'network',
    }
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const mediaType = contentType.startsWith('image/') ? contentType : 'image/jpeg'
  const buffer = await res.arrayBuffer()
  return { bytes: new Uint8Array(buffer), mediaType }
}
