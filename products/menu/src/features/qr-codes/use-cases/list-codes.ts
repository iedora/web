import type { QrCodeListRow, QrCodesGateway } from '../ports'

/**
 * Admin list. Returns every row joined with its bound restaurant. No
 * pagination yet — sticker batches are small and the admin only sees the
 * full registry.
 */
export async function listCodes(gw: QrCodesGateway): Promise<QrCodeListRow[]> {
  return gw.list()
}
