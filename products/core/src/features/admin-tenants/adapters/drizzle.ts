import 'server-only'
import { and, asc, count, desc, eq, ilike, sql } from 'drizzle-orm'
import { getCoreDb, schema } from '@iedora/core-auth'
import type { Scope } from '@iedora/core-auth/scopes'
import type { ProductId } from '@iedora/brand'
import type { SubscriptionStatus } from '@iedora/core-billing'

import type {
  AdminTenantsGateway,
  ListTenantsInput,
  ListTenantsResult,
  TenantDetail,
  TenantMemberRow,
  TenantRow,
  TenantSubscriptionRow,
} from '../ports'

/**
 * Production AdminTenantsGateway — Drizzle-backed reads against the
 * `core` schema. Server-only — the Drizzle client never belongs on
 * the client.
 *
 * Member counts come from a single grouped sub-query joined onto the
 * tenant list (one round-trip). Subscription detail in `getTenant`
 * fans out into a small extra query — bounded by the tenant's
 * product enrolment count (1 today, low single digits in the future).
 */
export function drizzleAdminTenantsGateway(): AdminTenantsGateway {
  return {
    async listTenants(input: ListTenantsInput): Promise<ListTenantsResult> {
      const db = getCoreDb()
      const offset = (input.page - 1) * input.pageSize

      const filter = input.q ? ilike(schema.tenant.name, `%${input.q}%`) : undefined

      const orderCol =
        input.sortBy === 'name' ? schema.tenant.name : schema.tenant.createdAt
      const orderBy =
        input.sortDirection === 'asc' ? asc(orderCol) : desc(orderCol)

      // Member count per tenant via a left-join + group-by. Keeps
      // empty tenants in the list (count = 0).
      const memberCountExpr = sql<number>`count(${schema.tenantMember.id})::int`

      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id: schema.tenant.id,
            name: schema.tenant.name,
            createdAt: schema.tenant.createdAt,
            updatedAt: schema.tenant.updatedAt,
            memberCount: memberCountExpr,
          })
          .from(schema.tenant)
          .leftJoin(
            schema.tenantMember,
            eq(schema.tenantMember.tenantId, schema.tenant.id),
          )
          .where(filter)
          .groupBy(
            schema.tenant.id,
            schema.tenant.name,
            schema.tenant.createdAt,
            schema.tenant.updatedAt,
          )
          .orderBy(orderBy)
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ value: count() })
          .from(schema.tenant)
          .where(filter),
      ])

      const tenants: TenantRow[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        memberCount: Number(r.memberCount ?? 0),
      }))

      return {
        tenants,
        total: Number(totalRow[0]?.value ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      }
    },

    async getTenant(tenantId: string): Promise<TenantDetail | null> {
      const db = getCoreDb()
      const [tenantRow] = await db
        .select()
        .from(schema.tenant)
        .where(eq(schema.tenant.id, tenantId))
        .limit(1)
      if (!tenantRow) return null

      const [memberRows, subscriptionRows] = await Promise.all([
        db
          .select({
            id: schema.tenantMember.id,
            userId: schema.user.id,
            userEmail: schema.user.email,
            userName: schema.user.name,
            scopes: schema.tenantMember.scopes,
            createdAt: schema.tenantMember.createdAt,
          })
          .from(schema.tenantMember)
          .innerJoin(
            schema.user,
            eq(schema.user.id, schema.tenantMember.userId),
          )
          .where(eq(schema.tenantMember.tenantId, tenantId))
          .orderBy(asc(schema.tenantMember.createdAt)),
        db
          .select()
          .from(schema.tenantSubscription)
          .where(eq(schema.tenantSubscription.tenantId, tenantId))
          .orderBy(asc(schema.tenantSubscription.product)),
      ])

      const members: TenantMemberRow[] = memberRows.map((m) => ({
        id: m.id,
        userId: m.userId,
        userEmail: m.userEmail,
        userName: m.userName,
        scopes: m.scopes as readonly Scope[],
        createdAt: m.createdAt,
      }))

      const subscriptions: TenantSubscriptionRow[] = subscriptionRows.map(
        (s) => ({
          id: s.id,
          product: s.product as ProductId,
          plan: s.plan,
          status: s.status as SubscriptionStatus,
          currentPeriodStart: s.currentPeriodStart,
          currentPeriodEnd: s.currentPeriodEnd,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }),
      )

      // Member count from the loaded array — saves a separate count(*).
      const tenant: TenantRow = {
        id: tenantRow.id,
        name: tenantRow.name,
        createdAt: tenantRow.createdAt,
        updatedAt: tenantRow.updatedAt,
        memberCount: members.length,
      }

      return { tenant, members, subscriptions }
    },
  }
}

// Keep the `and` import alive if a future filter (e.g., dateRange)
// extends `listTenants` without re-importing.
void and
