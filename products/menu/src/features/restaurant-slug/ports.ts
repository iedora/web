/**
 * SlugRegistry — the slice's only dependency on the `restaurant` row's
 * `slug` column. Two operations, both narrow:
 *
 *   - `findMatching(base)` — given a base like `sushi-place`, returns
 *     every existing slug that's either equal to `base` or matches the
 *     `base-N` collision-suffix pattern. The `nextAvailableSlug`
 *     use-case folds this into the smallest free slug.
 *
 *   - `rename(restaurantId, newSlug)` — atomic claim. Returns
 *     `{ok:false, reason:'taken'}` on a unique-violation so the caller
 *     can surface a user-facing error without bubbling raw 23505 codes.
 *
 * No Drizzle / Next types leak through. Production wires
 * `drizzleSlugRegistry`; tests wire fakes.
 */

export type RenameResult =
  | { ok: true }
  | { ok: false; reason: 'taken' }

export interface SlugRegistry {
  findMatching(base: string): Promise<string[]>
  rename(restaurantId: string, newSlug: string): Promise<RenameResult>
}
