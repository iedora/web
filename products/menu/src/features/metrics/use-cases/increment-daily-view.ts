import 'server-only'
import type { LanguageCode } from '@/features/i18n'
import type { MetricsGateway } from '../ports'
import { toDayString } from '../range'

/**
 * Beacon-side write (AGENTS.md hard rule #13). The caller (the
 * `/api/track/[slug]` route) has already confirmed the visitor is newly
 * counted for this `(visitor, restaurant, hour)` triple via the `view_seen`
 * dedup table; this bump is the second leg of the two-table tracking
 * scheme. Keeping it as a single atomic upsert is non-negotiable — see the
 * adapter for the reason.
 */
export async function incrementDailyView(
  metrics: MetricsGateway,
  restaurantId: string,
  organizationId: string,
  language: LanguageCode,
): Promise<void> {
  await metrics.incrementDailyView({
    restaurantId,
    organizationId,
    day: toDayString(),
    language,
  })
}
