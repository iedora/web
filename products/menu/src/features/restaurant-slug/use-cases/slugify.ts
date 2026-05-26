/**
 * Pure: name → URL-safe slug. Lower-cases, strips diacritics, collapses
 * non-alphanumerics to a single dash, trims edges, caps at 40 chars.
 *
 * Returns `"restaurant"` as a fallback when the input has no usable
 * characters (just emojis, just punctuation, only whitespace) so the
 * caller always gets a valid seed to feed to `nextAvailableSlug`.
 *
 * Framework-free — directly testable, no `server-only`.
 */
export function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'restaurant'
}

/**
 * Slug-format check used at the rename boundary. Requires at least 2
 * characters (first + last must be alphanumeric, optional dashes in
 * between), max 40. Exposed here so the UI can disable the Save button
 * without round-tripping for validation.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/
export function isValidSlugShape(value: string): boolean {
  return SLUG_RE.test(value)
}
