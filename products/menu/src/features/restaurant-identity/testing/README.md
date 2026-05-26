# restaurant-identity/testing — slice E2E surface

`seedRestaurant({ organizationId, name, slug, ... })` inserts a row
directly via SQL. Returns `{ restaurantId, slug, name, organizationId }`.
Use the returned `restaurantId` for child-table seeds (menu-builder,
metrics, qr-codes).

Routes: `restaurantIdentityRoutes.{home,theme,qr}(slug)`.
