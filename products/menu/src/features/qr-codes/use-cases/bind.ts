import { normalizeQrCode } from '../code'
import type { QrCodesGateway } from '../ports'

export type BindInput = { code: string; restaurantId: string }

export type BindResult =
  | { ok: true }
  | { ok: false; error: 'code_not_found' | 'restaurant_not_found' }

export async function bindCode(
  gw: QrCodesGateway,
  input: BindInput,
): Promise<BindResult> {
  const code = normalizeQrCode(input.code)
  const exists = await gw.restaurantExists(input.restaurantId)
  if (!exists) return { ok: false, error: 'restaurant_not_found' }
  const { found } = await gw.bind({ code, restaurantId: input.restaurantId })
  if (!found) return { ok: false, error: 'code_not_found' }
  return { ok: true }
}
