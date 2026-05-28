/**
 * Cross-product registry — names + URLs.
 *
 * Single source of truth for "which products exist?" and "where does
 * each product live?". Anyone who needs either calls into this module
 * — no magic strings, no per-call env reads. Zero cross-product
 * workspace dependency: the registry lives in `brand`, not in the
 * product itself.
 *
 * Per-product PATH BUILDERS (e.g. `signInUrl()` for `core`) still
 * live inside that product's package (`@iedora/product-core/url`).
 * Split:
 *
 *   - this file        → "which products exist? where do they live?"
 *   - product-X/url    → "how to build /foo under X"
 *
 * URL backing: each entry reads `NEXT_PUBLIC_<ID>_URL`. Next.js inlines
 * those at build time, which is why the switch is hand-written —
 * `process.env[dynamicKey]` is NOT inlined.
 *
 * Adding a product:
 *   1. Append the id to `PRODUCTS`.
 *   2. Add a `case` branch to `productUrl` (TypeScript exhaustiveness
 *      catches the missing branch).
 *   3. The new env var (`NEXT_PUBLIC_<ID>_URL`) is composed by the
 *      local dev environments (dev) and Kamal/proxy configuration (prod).
 *
 * Pure — no `server-only`, no I/O, safe for client + server.
 */

import { BRAND_DOMAIN } from './index'

/**
 * The canonical product-id constants. Use these instead of bare
 * strings (`PRODUCTS.menu`, not `'menu'`) so a rename surfaces as a
 * compile error everywhere.
 */
export const PRODUCTS = {
  menu: 'menu',
  core: 'core',
  imopush: 'imopush',
} as const

export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]

export function productUrl(id: ProductId): string {
  switch (id) {
    case PRODUCTS.menu:
      return process.env.NEXT_PUBLIC_MENU_URL ?? `https://menu.${BRAND_DOMAIN}`
    case PRODUCTS.core:
      return process.env.NEXT_PUBLIC_CORE_URL ?? `https://core.${BRAND_DOMAIN}`
    case PRODUCTS.imopush:
      return (
        process.env.NEXT_PUBLIC_IMOPUSH_URL ?? `https://imopush.${BRAND_DOMAIN}`
      )
  }
}
