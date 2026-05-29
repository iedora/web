/**
 * Cross-product onboarding taxonomy — single source of truth for the
 * **shape** of every product's onboarding flow. Lives in `@iedora/brand`
 * (not in the product packages) so:
 *
 *   - `@iedora/core-auth`'s `tenant_product_state` projection table has a
 *     stable enum of valid `current_step` values per product.
 *   - `@iedora/product-core`'s admin surface can render every product's
 *     onboarding state GENERICALLY — by step key + status — without
 *     importing anything product-specific.
 *   - Each product imports its own step keys from here, eliminating
 *     duplicate string literals.
 *
 * Roles vs steps: a product's **steps** are the wizard rungs the
 * operator passes through; the **status** is the lifecycle state the
 * projection reports to admin (pending → in-progress → completed,
 * with `skipped` as a terminal escape). Adding a product = one entry
 * in `PRODUCT_ONBOARDING_STEPS`; adding a step = one entry inside
 * that product's record.
 *
 * Framework-free. No `server-only`, no DB, no JSX. Safe for client + server.
 */

import { PRODUCTS, type ProductId } from './products'

// ── Onboarding statuses (lifecycle) ─────────────────────────────────

/**
 * Lifecycle of a tenant's relationship with a product. The projection
 * row reports one of these as the high-level summary.
 */
export const PRODUCT_ONBOARDING_STATUSES = {
  pending: 'pending',
  inProgress: 'in-progress',
  completed: 'completed',
  skipped: 'skipped',
} as const
export type ProductOnboardingStatus =
  (typeof PRODUCT_ONBOARDING_STATUSES)[keyof typeof PRODUCT_ONBOARDING_STATUSES]

/** Stable list — useful for select inputs / select-all-statuses filters. */
export const PRODUCT_ONBOARDING_STATUS_LIST = Object.values(
  PRODUCT_ONBOARDING_STATUSES,
) as readonly ProductOnboardingStatus[]

export function isProductOnboardingStatus(
  v: unknown,
): v is ProductOnboardingStatus {
  return (
    typeof v === 'string' &&
    (PRODUCT_ONBOARDING_STATUS_LIST as readonly string[]).includes(v)
  )
}

// ── Per-product step keys ────────────────────────────────────────────

/**
 * Step keys per product. Each product owns its sub-tree; consumers
 * narrow with `PRODUCT_ONBOARDING_STEPS[PRODUCTS.menu]`.
 *
 * Convention: step KEY is kebab-case (matches step PATH segments in
 * the URLs). Adding a new step = one entry; the projection's
 * `current_step` column accepts any of the values listed.
 */
export const PRODUCT_ONBOARDING_STEPS = {
  [PRODUCTS.menu]: {
    name: 'name',
    menu: 'menu',
  },
  [PRODUCTS.imopush]: {
    account: 'account',
    firstProperty: 'first-property',
  },
  [PRODUCTS.core]: {
    // No operator-facing onboarding for core today (signup is the
    // entry, and the cross-tenant admin surface is staff-only). The
    // entry is reserved so projection rows for `core` don't violate
    // the satisfies clause if we ever add one.
  },
} as const satisfies Record<ProductId, Record<string, string>>

/** Union of EVERY step key across EVERY product — useful for
 * type-checking projection writes that aren't narrowed by product. */
export type AnyOnboardingStepKey = {
  [P in ProductId]: keyof (typeof PRODUCT_ONBOARDING_STEPS)[P]
}[ProductId]

/** Per-product step key — narrow with the product type. */
export type OnboardingStepKeyFor<P extends ProductId> =
  keyof (typeof PRODUCT_ONBOARDING_STEPS)[P]

/** Per-product step VALUE (the kebab string written to the projection). */
export type OnboardingStepValueFor<P extends ProductId> =
  (typeof PRODUCT_ONBOARDING_STEPS)[P][keyof (typeof PRODUCT_ONBOARDING_STEPS)[P]]

/** Flat list of every step value across every product — handy for
 * iteration in admin renderers + test guards. */
export const PRODUCT_ONBOARDING_STEP_LIST: ReadonlyArray<{
  product: ProductId
  key: string
  value: string
}> = Object.entries(PRODUCT_ONBOARDING_STEPS).flatMap(([product, steps]) =>
  Object.entries(steps as Record<string, string>).map(([key, value]) => ({
    product: product as ProductId,
    key,
    value,
  })),
)
