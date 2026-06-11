/**
 * Public API of the restaurant-slug slice.
 *
 * Slug ALLOCATION and RENAME are owned by the Go menu service:
 * `POST /api/restaurants` generates a unique slug from the name, and
 * `POST /api/restaurants/{slug}/slug` validates + 409s on collision
 * (see `renameSlug` in `shared/api.ts` / the identity `updateSlug`
 * action). Only the pure helpers survive here — the UI uses them for
 * instant validation feedback without a round-trip.
 */
export { slugify, isValidSlugShape } from './slugify'
