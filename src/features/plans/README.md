# plans slice

Plan registry (free / casa) + entitlement gates.

## Public API (`@/features/plans`)

- `REGISTRY`, `PLAN_CODES`, `PLANS`, `DEFAULT_PLAN`, `getPlan`, `isPlanCode`
- `canAddRestaurant(orgId)` — structured `{ ok, reason, limit, current }` (never throws)
- `getOrganizationPlan(orgId)` — coerces unknown codes back to default
- `getOrganizationRestaurantCount(orgId)` — count for the dashboard meter
- `planHas(plan, feature)` — pure predicate

## Server Actions (`@/features/plans/actions`)

- `setOrganizationPlan(target)` — placeholder until Stripe wires in

## Port + adapter

`PlansGateway` (`./ports.ts`); production adapter is `./adapters/drizzle.ts`.

## Why this exists

AGENTS.md hard rule #11. Adding a plan = new folder under
`features/plans/<code>/`, new literal in `PlanCode` union, new
registry entry. The DB stores raw text; `getPlan` coerces unknown
values back to the default.
