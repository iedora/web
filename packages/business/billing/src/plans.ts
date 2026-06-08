import type { ProductId } from '@iedora/brand'
import { PLANS as MENU_PLANS } from './products/menu'

/**
 * Cross-product plan price catalogue. Derives from each product's
 * own plan registry under `./products/<product>/` — adding a paid
 * plan to a product means editing only that product's folder; this
 * file picks it up via the imported `PLANS` array.
 *
 * Shape rules:
 *   - Indexed by `product` then `code` so admin pickers can iterate
 *     a single product's offerings.
 *   - `monthlyCents` is the official list rate. Manual payments
 *     compare `amountCents` against `monthlyCents × validMonths` to
 *     derive discounts visibly.
 *   - `name` is the English label — i18n lives in the product's
 *     message catalogue (e.g. `Billing.plans.casa.name`); this string
 *     is the fallback when no locale match.
 */
export type PlanCatalogEntry = {
  code: string
  monthlyCents: number
  name: string
}

function fromPlans(
  plans: ReadonlyArray<{
    code: string
    englishName: string
    monthlyCents: number
  }>,
): Record<string, PlanCatalogEntry> {
  const out: Record<string, PlanCatalogEntry> = {}
  for (const p of plans) {
    out[p.code] = {
      code: p.code,
      monthlyCents: p.monthlyCents,
      name: p.englishName,
    }
  }
  return out
}

export const PLAN_CATALOG: Record<ProductId, Record<string, PlanCatalogEntry>> = {
  menu: fromPlans(MENU_PLANS),
  // Not commercialised yet — empty maps are the canonical shape and
  // `getPlanCatalogEntry` returns null for unknown codes. Add a plan
  // registry under `./products/<id>/` and import it here when the
  // product goes paid.
  core: {},
}

/**
 * Lookup with a sane fallback — unknown product OR unknown code
 * returns `null` rather than throwing, so admin surfaces that get a
 * stale plan code (renamed, removed) render "—" instead of crashing.
 */
export function getPlanCatalogEntry(
  product: ProductId,
  code: string,
): PlanCatalogEntry | null {
  const entries = PLAN_CATALOG[product]
  if (!entries) return null
  return entries[code] ?? null
}

/**
 * Convenience price-only lookup. Returns 0 for unknown — the caller's
 * discount math then yields 0% (no list price ⇒ no discount).
 */
export function getPlanPrice(product: ProductId, code: string): number {
  return getPlanCatalogEntry(product, code)?.monthlyCents ?? 0
}

/** Iterate a product's plans in declaration order. */
export function listProductPlans(product: ProductId): PlanCatalogEntry[] {
  const entries = PLAN_CATALOG[product]
  return entries ? Object.values(entries) : []
}
