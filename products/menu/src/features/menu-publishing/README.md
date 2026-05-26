# menu-publishing slice

Renders the public menu page and feeds the same data to the admin view.

## Public API (`@/features/menu-publishing`)

- `loadRestaurantSnapshot(slug)` — cached for the public page (tag: `restaurant:${slug}`)
- `loadRestaurantAdminMenus(slug)` — admin variant with Date hydration
- `loadMenuTree` / `localizeTree` — raw tree fetch + per-render i18n reducer
- `revalidateRestaurant(slug)` — the single mutation chokepoint
- `SAMPLE_MENU`, `SAMPLE_MENU_NAME`, `buildI18n`, `pickDefault` — seed for the dashboard "Sample menu" button

## RSC surface (`@/features/menu-publishing/rsc`)

- `menu-renderer` — consumes the template registry
- `templates/{classic,minimal}/` — per-template modules
- `templates/registry` — open/closed pattern (AGENTS.md hard rule #8)

## Cache strategy

`unstable_cache` + per-slug tag. Mutations always call `revalidateRestaurant(slug)`
which uses `updateTag` for read-your-writes. **Never** `revalidatePath('/r/${slug}')`
from a mutation — AGENTS.md hard rule #12.

## Notes

No DB port yet — use-cases call Drizzle (`@/shared/db/client`) directly. Trade-off: four
files would need rewriting to introduce a port today for marginal benefit. When
tests land, introduce a `MenuReadPort` and an adapter. View tracking
(`incrementDailyView`) lives in `@/features/metrics` — the beacon route imports
it directly.
