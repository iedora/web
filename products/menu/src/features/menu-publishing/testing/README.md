# menu-publishing/testing — slice E2E surface

The public menu has no own seeds — it renders whatever the builder has
inserted. Surface holds route helpers only.

- `menuPublishingRoutes.public(slug)` → `/r/{slug}`
- `menuPublishingRoutes.track(slug)` → `/api/track/{slug}` (beacon)
- `publicVisitorProfile` — placeholder for symmetry.

For beacon-driven specs, see `@/shared/testing/e2e-beacon`.
