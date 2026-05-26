# restaurant-slug slice

Owns the public URL identifier (`restaurant.slug` column). Two operations:

1. **Auto-allocate** a slug at insert time from the restaurant name —
   used by onboarding so the operator never has to think about URLs.
2. **Rename** an existing slug — used by the dashboard settings page
   when a restaurant rebrands.

Both pass through the same shape rules (2–40 lowercase alphanumerics +
hyphens, must start AND end with alphanumeric) and the same collision
semantics (unique violation surfaces as `{ok: false, reason: 'taken'}`).

## Public API (`@/features/restaurant-slug`)

- `slugify(name)` — pure, NFKD-fold + ASCII-strip + dash-collapse.
  Always returns a non-empty string (`"restaurant"` fallback).
- `isValidSlugShape(s)` — pure regex check; UI uses it to enable/disable
  the Save button without a server round-trip.
- `nextAvailableSlug(base)` — async, asks the registry for collisions
  and returns the smallest free slug in the `base`, `base-2`, …
  sequence.
- `rename(restaurantId, newSlug)` — async, validates shape + claims the
  slug atomically (typed `taken` on conflict).

## Port

`SlugRegistry` (`./ports.ts`). Production adapter:
`./adapters/drizzle.ts` (Postgres, `restaurant.slug` column).

## Why this exists

The slug is the only piece of `restaurant` writeable from BOTH the
onboarding path (insert + auto-allocate) and the settings path (later
rename). Extracting it into its own slice means:

- Onboarding actions don't reinvent the slugify + collision dance.
- Restaurant-identity slice stays focused on identity-as-presentation
  (name, description, images) without owning URL plumbing.
- The race-safety contract (`23505` → `taken`) lives in one adapter,
  reused by both consumers.

## Consumers

- `app/onboarding/actions.ts` — calls `slugify(name)` + `nextAvailableSlug(base)`
  before the restaurant insert + the `auth.api.createOrganization` call.
- `features/restaurant-identity/actions.ts` — `updateSlug(currentSlug, next)`
  action delegates to `rename` here, then revalidates both old and new
  slug tags.
