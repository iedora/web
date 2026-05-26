import { normalizeQrCode } from '../code'
import type { QrCodesGateway } from '../ports'

export type DeleteCodeResult = { ok: true } | { ok: false; error: 'code_not_found' }

export async function deleteCode(
  gw: QrCodesGateway,
  rawCode: string,
): Promise<DeleteCodeResult> {
  const code = normalizeQrCode(rawCode)
  const { found } = await gw.deleteCode(code)
  if (!found) return { ok: false, error: 'code_not_found' }
  return { ok: true }
}
