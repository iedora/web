# upload/testing — slice E2E surface

Thin wrappers around `@/shared/testing/e2e-storage` plus the tenant
key convention from CLAUDE.md rule 9.

- `tenantKey(restaurantId, suffix)` → `r/{restaurantId}/{suffix}`.
- `putObject(key, body)` / `objectExists(key)` / `deleteObject(key)` —
  pass-through from the shared module.
