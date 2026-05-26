# menu-builder/testing — slice E2E surface

Seeds for the builder hierarchy (menu → category → item). All take the
parent IDs explicitly so specs compose them as needed.

- `seedMenu(restaurantId, { name?, position?, active? })`
- `seedCategory(menuId, restaurantId, { name?, position? })`
- `seedItem(categoryId, restaurantId, { name?, priceCents?, currency?, position?, available? })`

Routes: `menuBuilderRoutes.builder(slug, menuId)`.
