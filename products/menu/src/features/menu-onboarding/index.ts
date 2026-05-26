/**
 * Public API of the menu-onboarding slice.
 *
 * The slice is UI-only — no ports, adapters, or use-cases. The
 * heavy lifting (AI parse + menu write) lives in `menu-import`; this
 * slice just orchestrates the post-signup composition.
 */

export { MenuOnboardingPage } from './ui/menu-onboarding-page'
