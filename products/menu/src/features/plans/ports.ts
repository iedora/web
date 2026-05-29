import type { PlanCode } from './types'

/**
 * PlansGateway — the slice's only dependency on the outside world.
 *
 * Use-cases call methods on this interface; production wires it to
 * `drizzlePlans` (Drizzle + Postgres). Tests wire fakes against PGLite.
 *
 * Keep this surface minimal: just the I/O the gates and the setter need.
 */
export interface PlansGateway {
  /**
   * Returns the plan code stored on the organization row, or null when the
   * org is missing. The use-cases coerce unknown / null values back to the
   * default plan via `getPlan`, so this stays a raw string.
   */
  getOrgPlan(tenantId: string): Promise<string | null>

  /**
   * Counts the restaurants currently owned by the org. Plain integer, no
   * filtering — `canAddRestaurant` compares it against the plan's limit.
   */
  countOrgRestaurants(tenantId: string): Promise<number>

  /**
   * Persists a new plan code on the organization. Returns true when a row
   * was updated, false when nothing matched (org missing). Schema enforces
   * the column type; the use-case enforces the registry membership.
   */
  updateOrgPlan(
    tenantId: string,
    code: PlanCode,
    actor?: { userId: string; email?: string | null },
  ): Promise<boolean>

  /**
   * Counts AI menu-import generations for `tenantId` newer than
   * `since`. Used by `canGenerateAiMenu` to compare against the plan's
   * weekly limit.
   */
  countAiGenerationsSince(
    tenantId: string,
    since: Date,
  ): Promise<number>

  /**
   * Records that an AI menu-import generation just ran for the org.
   * One row per call — the weekly counter is derived, not stored.
   */
  recordAiGeneration(tenantId: string): Promise<void>
}
