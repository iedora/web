# metrics slice

View tracking + organization-level analytics.

## Public API (`@/features/metrics`)

- `incrementDailyView(restaurantId, orgId, language)` — beacon-side write (hard rule #13)
- `getOrganizationMonthlyViews(orgId)` — cached, drives the dashboard meter
- `getOrganizationAnalytics(orgId, range)` — cached, feeds the analytics page
- `ANALYTICS_RANGES`, `isAnalyticsRange`, `rangeBounds`, `currentMonthBounds`, `toDayString` — pure helpers
- Types: `AnalyticsRange`, `DailyPoint`, `OrgAnalytics`, `MetricsGateway`

## Port + adapter

`MetricsGateway` (`./ports.ts`); production adapter is `./adapters/drizzle.ts`.

## Why this exists

AGENTS.md hard rule #13: view tracking is beacon-based. The
`incrementDailyView` upsert stays atomic — single statement,
`onConflictDoUpdate` on `(restaurantId, day, language)`. Dedup
`(visitor, restaurant, hour)` lives in `view_seen` at the route layer.
