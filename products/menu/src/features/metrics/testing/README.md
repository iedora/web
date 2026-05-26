# metrics/testing — slice E2E surface

- `seedDailyView({ organizationId, restaurantId, day, language?, count? })`
  — direct upsert into `daily_view`. Pair with
  `@/shared/testing/e2e-beacon` for beacon-flow coverage.
- `metricsRoutes.analytics` — `/dashboard/analytics`.
