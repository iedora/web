import type { PlanLimits } from '../../shared/api'

/**
 * DISPLAY-ONLY plan metadata for the billing page. The Go menu service
 * owns the actual entitlements (`PlanRegistry` in
 * services/internal/menu/plans.go — `GET /api/plan` returns the
 * effective `PlanLimits`) and enforces every gate server-side; this
 * registry only carries what the UI needs to render plan cards:
 * labels live in i18n (`Billing.plans.<code>.*`), feature bullet
 * lists and the marketing recommendation live here.
 *
 * Limits mirror the Go registry 1:1 (`-1` = unlimited) so the cards
 * can print capacity copy without an extra API call per plan.
 */

export type PlanCode = 'menu_free' | 'menu_pro' | 'menu_agency'

/** Discrete capabilities a plan card advertises / the UI gates on. */
export type PlanFeature = 'exportPdf' | 'customBranding' | 'analytics'

export type PlanDisplay = {
  readonly code: PlanCode
  /** English label, fallback when no locale-specific label exists. */
  readonly englishName: string
  /** Mirrors Go `PlanLimits` (-1 = unlimited). Display copy only. */
  readonly restaurants: number
  readonly monthlyViews: number
  readonly features: ReadonlyArray<PlanFeature>
  readonly isDefault: boolean
  readonly isRecommended?: boolean
}

export const REGISTRY = {
  menu_free: {
    code: 'menu_free',
    englishName: 'Free',
    restaurants: 1,
    monthlyViews: 1000,
    features: [],
    isDefault: true,
  },
  menu_pro: {
    code: 'menu_pro',
    englishName: 'Pro',
    restaurants: 3,
    monthlyViews: 20000,
    features: ['exportPdf', 'customBranding', 'analytics'],
    isDefault: false,
    isRecommended: true,
  },
  menu_agency: {
    code: 'menu_agency',
    englishName: 'Agency',
    restaurants: -1,
    monthlyViews: -1,
    features: ['exportPdf', 'customBranding', 'analytics'],
    isDefault: false,
  },
} as const satisfies Record<PlanCode, PlanDisplay>

export const PLAN_CODES = Object.keys(REGISTRY) as PlanCode[]

export const PLANS: readonly PlanDisplay[] = Object.values(REGISTRY)

/**
 * Default ENTITLEMENTS for callers without a tenant (staff browsing the
 * dashboard chrome). Mirrors Go's `DefaultPlan` (menu_free).
 */
export const DEFAULT_PLAN: PlanLimits = {
  code: 'menu_free',
  restaurants: 1,
  monthlyViews: 1000,
  aiGenerationsWeek: 1,
}

export function isPlanCode(code: string): code is PlanCode {
  return code in REGISTRY
}

/** Display metadata for a raw code; unknown codes fall back to free. */
export function getPlanDisplay(code: string): PlanDisplay {
  return isPlanCode(code) ? REGISTRY[code] : REGISTRY.menu_free
}

/**
 * UI feature gate over the Go `PlanLimits` shape. Purely cosmetic
 * (hide a nav link, pre-disable a button) — the Go service is the
 * authority on what the token may actually do.
 */
export function planHas(plan: Pick<PlanLimits, 'code'>, feature: PlanFeature): boolean {
  return getPlanDisplay(plan.code).features.includes(feature)
}
