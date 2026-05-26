import type { SlugRegistry } from '../ports'

/**
 * Returns the smallest unused slug in the `base`, `base-2`, `base-3`,
 * … sequence. Asks the registry for any slug matching that pattern,
 * builds a Set, then walks the integers until a gap is found.
 *
 * Race notes: two concurrent inserts seeing the same `findMatching`
 * result will both target the same candidate; one wins the unique
 * index, the other receives a `taken` from `rename` (or a duplicate
 * insert error in the onboarding path). At current onboarding rates
 * (handful per day) this is acceptable; revisit when traffic justifies
 * a serialised allocator.
 *
 * The caller MUST validate `base` via `slugify()` first — feeding a
 * raw user string here would compare against unnormalised data and
 * always return `base` (because no row matches a malformed base).
 */
export async function nextAvailableSlug(
  registry: SlugRegistry,
  base: string,
): Promise<string> {
  const used = new Set(await registry.findMatching(base))
  if (!used.has(base)) return base
  for (let i = 2; i <= 1000; i++) {
    const candidate = `${base}-${i}`
    if (!used.has(candidate)) return candidate
  }
  // 1000 distinct restaurants whose names slugify to the same base is
  // implausible enough that giving up is fine. Surface as an error so
  // the caller can fall back to "pick another name".
  throw new Error(`slug-allocator: 1000 collisions for base ${base}`)
}
