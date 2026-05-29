import type { Scope } from '@iedora/core-auth/scopes'
import type { SubscriptionStatus } from '@iedora/core-billing'
import type { ProductId } from '@iedora/brand'

/**
 * Admin-tenants slice ports — the narrow surface the cross-tenant
 * admin UI under `/core/admin/tenants/*` consumes. Replaces the
 * deleted `admin-orgs` feature; same role (staff drilling into
 * tenants across the estate for growth + support), new data model.
 *
 * Read-only today (list + get). Mutating verbs (delete tenant,
 * remove member, change member scopes, change subscription) will
 * land in a follow-up PR alongside the `staff.core.tenants.delete`
 * + `staff.core.members.*` actions.
 */

export type TenantRow = {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
  /** Aggregated count — cheap to compute alongside the list query. */
  memberCount: number
}

export type ListTenantsInput = {
  page: number
  pageSize: number
  /** Free-text — matches tenant name (case-insensitive). */
  q?: string
  sortBy: 'createdAt' | 'name'
  sortDirection: 'asc' | 'desc'
}

export type ListTenantsResult = {
  tenants: TenantRow[]
  /** Total count for the filter — drives pagination chrome. */
  total: number
  page: number
  pageSize: number
}

export type TenantMemberRow = {
  id: string
  userId: string
  userEmail: string
  userName: string
  /** Raw scope set persisted on `tenant_member.scopes`. */
  scopes: readonly Scope[]
  createdAt: Date
}

export type TenantSubscriptionRow = {
  id: string
  product: ProductId
  plan: string
  status: SubscriptionStatus
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Full tenant view — the right-hand panel of the detail page. Built
 * by joining `tenant` + `tenant_member` (+ user) + `tenant_subscription`
 * in a few independent queries (no big nested query, since result
 * sizes are bounded by membership count).
 */
export type TenantDetail = {
  tenant: TenantRow
  members: TenantMemberRow[]
  subscriptions: TenantSubscriptionRow[]
}

export interface AdminTenantsGateway {
  /**
   * Paginated tenant list with member counts. The `q` filter is a
   * simple ILIKE on `tenant.name` — cheap, no fuzzy / full-text yet.
   */
  listTenants(input: ListTenantsInput): Promise<ListTenantsResult>

  /**
   * Read one tenant by id plus every membership + active product
   * subscription. Returns `null` when the id is unknown.
   */
  getTenant(tenantId: string): Promise<TenantDetail | null>
}
