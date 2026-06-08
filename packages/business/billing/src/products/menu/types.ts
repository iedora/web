/**
 * Menu product plan contract. Owned by `@iedora/billing` because
 * plans = pricing + a product-specific capability bundle, and pricing
 * is a billing concern. Lives under `products/menu/` so adding plans
 * for other products doesn't crowd a single file.
 *
 * `PlanLimits` carries menu-specific capacity gates. New products
 * define their own `PlanLimits` in their own folder under this
 * directory.
 */

export type PlanCode = 'free' | 'casa'

/**
 * Discrete capabilities a menu plan can unlock. Add a literal here
 * when you wire a new gated feature into the UI/DAL — every plan
 * module then states whether it includes it. Capacity-style gates
 * (e.g. restaurant count) live in `PlanLimits`, not here.
 */
export type PlanFeature =
  | 'exportPdf'
  | 'customBranding'
  | 'analytics'

export type PlanLimits = {
  /** Hard cap on restaurants per organization. Use `Infinity` for unlimited. */
  restaurants: number
  /**
   * Soft cap on combined public menu views per calendar month. We only nudge
   * the user toward an upgrade as they approach this number — never block
   * service. `Infinity` disables the meter entirely.
   */
  monthlyViews: number
  /**
   * Hard cap on AI menu-import generations per rolling 7-day window. Each
   * `analyzeMenuImage` call (the Gemini vision request) consumes one slot.
   * `0` disables the AI surface entirely; `Infinity` for unlimited.
   */
  aiMenuGenerationsPerWeek: number
}

export type Plan = {
  readonly code: PlanCode
  /** English label, used as fallback when no locale-specific label is present. */
  readonly englishName: string
  /**
   * List price per month, in EUR cents. Single source of truth for
   * the manual-payment discount calculator: `expected = monthlyCents
   * × validMonths`. `0` = free plan. When Stripe wires in, this is
   * still the official list — Stripe-driven invoices compare here too.
   */
  readonly monthlyCents: number
  readonly limits: PlanLimits
  readonly features: ReadonlySet<PlanFeature>
  /** Exactly one plan in the registry must set this to `true`. */
  readonly isDefault: boolean
  /**
   * Highlights the plan as the marketing recommendation in pricing
   * cards / upgrade prompts. At most one plan per registry should set
   * this. UI reads it via `getRecommendedPlan()` from `./registry`.
   */
  readonly isRecommended?: boolean
}
