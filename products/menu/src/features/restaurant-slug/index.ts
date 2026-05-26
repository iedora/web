import 'server-only'
import { drizzleSlugRegistry } from './adapters/drizzle'
import { nextAvailableSlug as _nextAvailableSlug } from './use-cases/next-available'
import { rename as _rename, type RenameResult } from './use-cases/rename'

/**
 * Public API of the restaurant-slug slice. Production wires the
 * Drizzle-backed registry; tests import the use-cases directly and
 * pass fakes.
 *
 * The pure helpers `slugify` + `isValidSlugShape` live in
 * `./use-cases/slugify` and can be imported wherever — they have no
 * server-only side effects.
 */

export async function nextAvailableSlug(base: string): Promise<string> {
  return _nextAvailableSlug(drizzleSlugRegistry, base)
}

export async function rename(
  restaurantId: string,
  newSlug: string,
): Promise<RenameResult> {
  return _rename(drizzleSlugRegistry, { restaurantId, slug: newSlug })
}

export { slugify, isValidSlugShape } from './use-cases/slugify'
export type { SlugRegistry } from './ports'
export type { RenameResult } from './use-cases/rename'
