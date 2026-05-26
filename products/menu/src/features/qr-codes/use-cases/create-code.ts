import { generateQrCode, isValidQrCodeShape, normalizeQrCode } from '../code'
import type { QrCodesGateway } from '../ports'

export type CreateCodeInput = {
  /**
   * Caller-supplied code string. When `undefined`, the use-case generates
   * one. When provided, normalised + shape-validated; rejected with
   * `error: 'invalid_shape'` on failure.
   */
  code?: string
  /**
   * Optional bind on creation. When set, the restaurant existence is
   * checked first; `error: 'restaurant_not_found'` if missing.
   */
  restaurantId?: string
  label?: string
}

export type CreateCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: 'invalid_shape' | 'restaurant_not_found' | 'duplicate' }

export async function createCode(
  gw: QrCodesGateway,
  input: CreateCodeInput,
): Promise<CreateCodeResult> {
  let code: string
  if (input.code !== undefined) {
    const norm = normalizeQrCode(input.code)
    if (!isValidQrCodeShape(norm)) return { ok: false, error: 'invalid_shape' }
    code = norm
  } else {
    code = generateQrCode()
  }

  if (input.restaurantId) {
    const exists = await gw.restaurantExists(input.restaurantId)
    if (!exists) return { ok: false, error: 'restaurant_not_found' }
  }

  const restaurantId = input.restaurantId ?? null
  const { duplicate } = await gw.insertCode({
    code,
    restaurantId,
    boundAt: restaurantId ? new Date() : null,
    label: input.label?.trim() || null,
  })
  if (duplicate) return { ok: false, error: 'duplicate' }
  return { ok: true, code }
}
