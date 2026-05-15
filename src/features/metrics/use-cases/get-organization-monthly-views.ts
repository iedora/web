import 'server-only'
import type { MetricsGateway } from '../ports'
import { currentMonthBounds } from '../range'

/**
 * Sum of scans for the current calendar month (UTC). Used by the dashboard's
 * "views-this-month" meter against the plan's monthly cap.
 */
export async function getOrganizationMonthlyViews(
  metrics: MetricsGateway,
  organizationId: string,
): Promise<number> {
  const { start, end } = currentMonthBounds()
  return metrics.sumScans(organizationId, start, end)
}
