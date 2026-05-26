import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'
import type { PlanCode } from '../types'

/**
 * `org_plan` is menu-owned billing metadata keyed by Zitadel orgId.
 * `setPlan` upserts so a spec can flip free → casa to exercise the
 * upgrade flow without re-seeding the row.
 */
export async function setPlan(
  organizationId: string,
  plan: PlanCode,
): Promise<void> {
  const sql = testDb()
  await sql`
    INSERT INTO "menu"."org_plan" (organization_id, plan)
    VALUES (${organizationId}, ${plan})
    ON CONFLICT (organization_id) DO UPDATE
      SET plan = EXCLUDED.plan, updated_at = now()
  `
}

export async function getPlan(organizationId: string): Promise<PlanCode | null> {
  const sql = testDb()
  const [row] = await sql<{ plan: PlanCode }[]>`
    SELECT plan FROM "menu"."org_plan" WHERE organization_id = ${organizationId}
  `
  return row?.plan ?? null
}
