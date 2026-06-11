/**
 * Public API of the menu-onboarding slice.
 *
 * The heavy lifting (AI parse + menu write) lives in `menu-import`;
 * this slice orchestrates the post-signup composition and owns the
 * two small read/write helpers around `restaurant.onboarding_completed_at`
 * — the flag the `/menu/onboarding` resume gate reads to decide
 * whether to bounce the operator back into step 2.
 */

export { MenuOnboardingPage } from './ui/menu-onboarding-page'
export { createOnboardingRestaurant } from './use-cases/create-restaurant'
export { findPendingOnboardingRestaurant } from './use-cases/find-pending-restaurant'
export { markRestaurantOnboardingComplete } from './use-cases/mark-complete'
export { tenantHasRestaurant } from './use-cases/tenant-has-restaurant'
export {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_STEP_TOTAL,
  ADD_ANOTHER_QUERY_KEY,
  ADD_ANOTHER_QUERY_VALUE,
  addAnotherRestaurantHref,
  type OnboardingStep,
  type OnboardingStepKey,
} from './steps'
