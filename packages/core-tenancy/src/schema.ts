import {
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  pgSchema,
} from 'drizzle-orm/pg-core'
import type { ProductId, ProductOnboardingStatus } from '@iedora/brand'

/**
 * `core.tenant_product_state` — projection table written by every
 * product after it mutates its own onboarding/lifecycle state.
 *
 * **CQRS-lite contract**: each product is the source of truth for its
 * OWN state (e.g. menu owns `restaurant.onboarding_completed_at`).
 * After each mutation, the product calls `projectProductState({...})`
 * which writes a tiny snapshot row here. Core admin reads from THIS
 * table only — it never opens menu's DB.
 *
 * Why a projection (not a query): the products live in DIFFERENT
 * Postgres databases (microservices-ready). A `JOIN` across DBs is
 * impossible; even within the same Postgres, hard FKs across products
 * are banned by the boundary rules. The projection is the seam.
 *
 * Why one row per `(tenant, product)`: the admin doesn't need
 * history (audit_log has it). It needs a snapshot. UNIQUE on the
 * pair enforces "one current state per product".
 *
 * `current_step` is a kebab string from `PRODUCT_ONBOARDING_STEPS[product]`
 * in `@iedora/brand` — typed at the call site, opaque to the DB.
 *
 * `payload` is a free-form JSON blob each product owns. Examples:
 *   - menu:    `{ restaurantSlug, restaurantId }`
 *   - imopush: `{ propertyId, listingPlatforms: [...] }`
 * Core's admin renderer NEVER reads payload — keeps the cross-product
 * boundary clean. Helpful for the product's own debugging / future
 * reverse-lookup.
 */
export const coreSchema = pgSchema('core')

export const tenantProductState = coreSchema.table(
  'tenant_product_state',
  {
    id: text('id').primaryKey(),
    /** Soft reference (`core.tenant.id`). No FK so this package stays
     * importable from products without pulling auth's schema graph. */
    tenantId: text('tenant_id').notNull(),
    /** `PRODUCTS.<id>` from `@iedora/brand` — opaque string here. */
    product: text('product').$type<ProductId>().notNull(),
    /** `PRODUCT_ONBOARDING_STATUSES.<key>` from `@iedora/brand`. */
    status: text('status').$type<ProductOnboardingStatus>().notNull(),
    /** Current step key. `null` once `status='completed'` / `'skipped'`. */
    currentStep: text('current_step'),
    /** Free-form, owned by the product. Core never reads. */
    payload: jsonb('payload'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_product_state_tenant_product_uniq').on(
      t.tenantId,
      t.product,
    ),
  ],
)

export type TenantProductStateRow = typeof tenantProductState.$inferSelect
