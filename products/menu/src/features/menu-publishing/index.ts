/**
 * Public API of the menu-publishing slice.
 *
 * The renderer + templates live under `@/features/menu-publishing/rsc/...`
 * and are imported directly by the public page and the theme preview — kept
 * off this barrel so consumers only pull in what they need. Data comes from
 * the Go menu service (shared/api); the old drizzle use-cases are gone.
 */
export { revalidateRestaurant } from './cache'
export { resolveQRCode } from '../../shared/api'
