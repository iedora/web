# plans/testing — slice E2E surface

- `setPlan(organizationId, planCode)` — upsert `org_plan`. Flip an org
  free → casa (or back) to exercise gate behaviour.
- `getPlan(organizationId)` — read back the current plan code.
- `planRoutes.billing` — `/dashboard/billing`.

The `PlanCode` union (`free | casa`) is the closed type from
`../types.ts` — adding a plan adds a literal automatically.
