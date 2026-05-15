/**
 * Plans contract. Closed union of `PlanCode` mirrors the language registry
 * pattern — adding a plan means a new folder with `index.ts`, a new code in
 * the union below, and a new entry in `registry.ts`. The DB stores the code
 * as plain text; the registry coerces unknown values back to the default.
 */

export type PlanCode = 'free' | 'casa'

/**
 * Discrete capabilities a plan can unlock. Add a literal here when you wire a
 * new gated feature into the UI/DAL — every plan module then states whether
 * it includes it. Capacity-style gates (e.g. restaurant count) live in
 * `PlanLimits`, not here.
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
}

export type Plan = {
  readonly code: PlanCode
  /** English label, used as fallback when no locale-specific label is present. */
  readonly englishName: string
  readonly limits: PlanLimits
  readonly features: ReadonlySet<PlanFeature>
  /** Exactly one plan in the registry must set this to `true`. */
  readonly isDefault: boolean
}
