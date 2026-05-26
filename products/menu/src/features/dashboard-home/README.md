# dashboard-home slice

Cross-feature aggregations for the admin dashboard home + the dashboard
chrome that wraps every authenticated page.

## Public API (`@/features/dashboard-home`)

- `listRestaurantsWithCounts(orgId)` — restaurants + menu/dish counts (org-scoped)
- `listMenusWithCounts(restaurantId)` — menus + category/dish counts
- Types: `RestaurantWithCounts`, `MenuWithCounts`, `DashboardReadPort`

Both wrappers are `React.cache()`-memoized per request.

## Server Actions (`@/features/dashboard-home/actions`)

- `setUserLocale(locale)` — persists the UI language cookie

## UI (`@/features/dashboard-home/ui/*`)

- `UserLocaleSwitcher`, `LogoutButton` — header chrome for the dashboard layout
- `KpiCard`, `ScansCard`, `ScansChart` — shared by `/dashboard` and `/dashboard/analytics`

## Port + adapter

`DashboardReadPort` (`./ports.ts`); production wires `./adapters/drizzle.ts`.

## Why this exists

The "with counts" reads are the dashboard's read-model. Menu-publishing
wraps `listMenusWithCounts` in `unstable_cache` for the admin per-slug
page; the dashboard home page calls `listRestaurantsWithCounts` directly.
