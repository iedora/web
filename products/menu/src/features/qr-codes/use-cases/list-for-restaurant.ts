import type { QrCodeRow, QrCodesGateway } from '../ports'

/**
 * Tenant-scoped reader for the restaurant dashboard's QR page. The
 * caller MUST have already verified ownership of `restaurantId` —
 * we don't re-check tenancy here (AGENTS.md hard rule #1: auth lives
 * upstream in the action / page shell).
 *
 * Returns the rows as-is; the page joins each with its public URL +
 * label for rendering.
 */
export async function listForRestaurant(
  gw: QrCodesGateway,
  restaurantId: string,
): Promise<QrCodeRow[]> {
  return gw.listForRestaurant(restaurantId)
}
