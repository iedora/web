# menu-onboarding

Onboarding step that lands a new customer right after restaurant
creation. Wraps the existing `menu-import` AI wizard in a full-page
composition with a clear "Skip — add manually" escape hatch.

## Public surface

- `MenuOnboardingPage` — client composition. Hosts `<MenuImportWizard>`
  for the AI flow and an `<a href="/dashboard">` skip control. Owns the
  page-level eyebrow + heading + subtitle; no chrome (no sidebar — the
  onboarding flow lives outside the dashboard shell).

## Composition

```
/onboarding              (existing)     name → submit → /onboarding/menu/<slug>
/onboarding/menu/<slug>  (new route)    AI photo upload → preview → /dashboard
                                        OR skip → /dashboard
```

The route file in `src/app/onboarding/menu/[slug]/page.tsx` is the
server-side entry — it auth-gates and resolves the restaurant, then
delegates to `<MenuOnboardingPage>` (this slice).

## Why a separate slice from `menu-import`?

`menu-import` owns the AI parsing + DB-write primitives. It's
already-composed surface (the per-restaurant dialog) is reusable across
the dashboard. `menu-onboarding` owns the post-signup orchestration:
which page hosts the wizard, what the success redirect is, what copy
sits around it. Keeping them apart means a future redesign of either
flow doesn't drag the other along.

## Cross-slice imports

- `@/features/menu-import/ui/menu-import-wizard` — the wizard component
  (UI subpath is a sanctioned cross-slice import per the slice rules).
