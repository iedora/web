# Tenancy model

Where restaurants live in the identity graph and how we evolve when the model strains.

## Shape today (v1)

```
identity.user ──(member, role)──> identity.organization
                                         │
                                         │ id (UUID)
                                         ▼
                               menu.restaurant.organizationId
```

**One organization → N restaurants.** A user can belong to multiple organizations. A restaurant references exactly one organization by UUID; menu's DB has no FK — the reference is logical, since identity data and menu data live in separate databases.

> **Identity provider in flux.** Today menu uses Better Auth's `organization` plugin locally for org membership; Zitadel (`auth.iedora.com`) is the deployed IdP but menu hasn't cut over yet (issue #20). The shape of org/membership stays the same after cutover; only the source-of-truth backend changes.

**Default onboarding** (`menu/src/app/onboarding/actions.ts`):

- First restaurant ever: create an organization for the user, then create the restaurant under it.
- Second / Nth restaurant: create the restaurant under the user's existing active organization. No new org minted.

A user with multiple restaurants has ONE organization by default, with N restaurants inside it.

## Why this fits

| Archetype | Description | Current pattern serves it? |
|---|---|---|
| **A — Solo owner** | One person, one restaurant, no team | trivial — org is invisible chrome |
| **B — Group owner** | One person, 3–5 restaurants, manages personally | one org, switch restaurants inside it |
| **C — Hired manager** | Works for a group, accesses only 1 of 5 restaurants | NOT YET — no per-restaurant role gating; everyone in org sees everything |
| **D — Co-workers** | Owner + chef + waiter share access to one restaurant | all members of same org, see same restaurants |

Three of four covered. Gap C is acceptable because no current or near-term customer asks for it.

## The escape hatch

In the +Restaurant flow, the user can opt into a separate organization:

> Add this restaurant in a **new organization** (separate team, separate billing)

If checked, onboarding creates a second org for the same user; menu's `restaurant.organizationId` points at it. Answers "I want my pop-up bar billed separately" and "these two restaurants have completely different staff."

Keep it as a deliberate UI affordance — not the default — so the simple case stays simple.

## Patterns considered and rejected

| Pattern | Why not |
|---|---|
| **User = Org (1:1)** | Kills archetype D — can't share a restaurant with a teammate |
| **Org-per-restaurant (N:N)** | Multi-restaurant owners switch orgs 3× to navigate; invitations multiply; per-org billing balloons. Heavy tax for a problem (C) we don't have |
| **Org → Project hierarchy** | The right *eventual* model — see Migration A. Costs we don't want today: two permission layers in every DAL guard, two-tier UX in every member list |
| **Personal + Shared orgs** | The right model once we have a "personal vs team" distinction. None exists today. First paying customer asking "can I keep my recipe-testing menu private?" is the signal to flip |

## Migration paths

Two evolutions are likely. Both are deliberately cheap from the current shape.

### Migration A — per-restaurant roles

**When:** archetype C arrives.

**Shape:**

```
identity.organization ──> identity.member          (org-wide role)
                                  ↘
                                    menu.restaurant_member  (per-restaurant role, optional)
```

`menu.restaurant_member` is a menu-owned table. Rows reference both `restaurant_id` and `user_id` (no FK across DBs).

**Authorization rule** (top to bottom, first match wins):
1. User has a row in `menu.restaurant_member` for this restaurant → that role.
2. Else, fall back to org-level `member.role`.
3. Else, no access.

**Steps:**
1. Add `menu.restaurant_member (restaurant_id, user_id, role, created_at)` migration.
2. Backfill empty — every existing user keeps full access via the org-level rule.
3. Extend `requireRestaurantAccess` to check `restaurant_member` first.
4. Add "Invite to this restaurant only" affordance in Team UI.

**Reversibility:** drop the table; org-level role is the canonical fallback.

**Doesn't change:** the `organization` / `member` tables, billing (still per-org), OIDC claims.

This is why we picked the v1 shape: migration to A is purely additive.

### Migration B — personal + shared orgs

**When:** a customer wants to separate personal/draft from production. Or we want a free-tier "personal testing" lane that doesn't share quota with paid restaurants.

**Shape:**

- New user signup auto-creates a `personal` org alongside the user row.
- Existing users get a one-time backfill: every org with a single owner-only member becomes their `personal` org.
- Add `organization.type: "personal" | "shared"` — UI hides personal orgs from "team" listings but keeps them for billing/quota.

**Reversibility:** drop the `type` column; treat every org uniformly.

**Doesn't change:** `restaurant.organizationId` (still points at an org), OIDC claims, billing primitives.

### Migration C — multi-level hierarchy (group · brand · restaurant)

**When:** a customer like LVMH walks in. Multiple brands each owning multiple menus; some staff scoped to a single menu, some to a brand, some across the whole group.

**Shape:**

```
identity.organization
  ├ LVMH       parent_id: NULL          (group)
  ├ Gucci      parent_id: LVMH          (brand)
  └ Versace    parent_id: LVMH          (brand)

menu.restaurant.organizationId  → Gucci or Versace  (never the group)
menu.restaurant_member          → Migration A's table
```

**Schema additions** (cumulative on top of A):
- `identity.organization.parent_id` — nullable, references `organization.id`.
- Nothing else.

**DAL guard for "can U access R?"** (first match wins):
1. User has a row in `restaurant_member` for R → that role.
2. User has a row in `restaurant_member` for some OTHER restaurant in R's org → no access (scoped membership rule).
3. User is org-level member of R's org → that role.
4. User is admin/owner of any ancestor org (walk `parent_id` chain) → that role.
5. Otherwise → no access.

**OIDC claim:** extend to include the org chain.

**Billing roll-up:** when plan is on the parent (`LVMH.plan = "casa-group"`), children defer. `getEffectivePlan(orgId)` walks `parent_id`.

**Reversibility:** `parent_id` is nullable + ignored. Drop the column, drop the rule-4 branch.

**Doesn't change:** restaurant ownership still points at the BRAND (never the group), OAuth client scopes, existing members without `parent_id`.

**Cost:** ~2 hours end-to-end. No data migration since `parent_id` defaults to null.

### Migration D — one org per restaurant

**When:** never. Documented so we remember we chose against it.

If we ever did need it: every org with N restaurants splits into N orgs. Tooling: "Split this organization" admin action that clones orgs, copies members, reassigns restaurants. Painful — every member needs N invitations, plans cloned. Don't do this unless billing and access genuinely don't model otherwise.

## Where the code expresses this

- `products/menu/src/features/identity/use-cases/create-organization.ts` — the call menu makes to mint an org.
- `products/menu/src/app/onboarding/actions.ts` — branches: first restaurant → create-org; otherwise reuse active org.
- `products/menu/src/features/auth/use-cases/require-restaurant-access.ts` — DAL guard that checks "does the caller's set of org IDs include this restaurant's org ID?"

When Migration A lands, `require-restaurant-access` gains a per-restaurant check ahead of the org check. When B lands, onboarding gains an "is the active org personal?" branch.
