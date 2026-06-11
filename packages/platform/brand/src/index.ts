/**
 * Iedora brand constants + URL validators + cross-product URL registry.
 *
 * Brand-level — strings about the iedora brand itself (name, apex
 * domain, contact email), URL-shape validators that don't depend on
 * any particular product, AND the cross-product URL registry
 * (`productUrl(PRODUCTS.menu)`, ...) so callers don't need a workspace dep
 * on a sibling product just to learn where it lives.
 *
 * Per-product PATH BUILDERS still live inside each product
 * (`@iedora/product-menu/shared/auth-urls` exports `signInUrl`, etc.).
 * The split:
 *
 *   - brand           → "where is product X?"  (productUrl(id))
 *   - product-X/…     → "how do I build /foo on X?" (xFooUrl(...))
 *
 * Pure: no env reads at module init, no I/O, safe to import from
 * server AND client components.
 */

export const BRAND_DOMAIN = 'iedora.com'
export const BRAND_NAME = 'iedora'
export const CONTACT_EMAIL = `hello@${BRAND_DOMAIN}`

/**
 * Absolute URL for the iedora apex. Reads `NEXT_PUBLIC_BRAND_URL` so
 * dev (`http://localhost:3000`) and prod (`https://iedora.com`) route
 * "Back to iedora" / footer-brand / sign-out fallback to the actual
 * host — same env-driven shape as `productUrl(PRODUCTS.<id>)`. Next.js
 * inlines the literal string access at build time; a dynamic
 * `process.env[key]` would NOT be inlined, which is why each URL gets
 * a hand-written branch.
 */
export function brandUrl(): string {
  return process.env.NEXT_PUBLIC_BRAND_URL ?? `https://${BRAND_DOMAIN}`
}

export { PRODUCTS, productUrl, type ProductId } from './products'

// ─── URL validators (no env, no I/O) ────────────────────────────────────

/**
 * Returns true iff `raw` parses as an absolute URL on the iedora apex
 * or any of its subdomains (`iedora.com`, `menu.iedora.com`,
 * `admin.iedora.com`, ...). `localhost` (any port) is also accepted so
 * the same validator works in dev.
 */
export function isSameIedoraOrigin(raw: string | undefined | null): boolean {
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === BRAND_DOMAIN || host.endsWith(`.${BRAND_DOMAIN}`)) return true
  return false
}
