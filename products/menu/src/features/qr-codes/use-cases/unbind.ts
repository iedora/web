import { normalizeQrCode } from '../code'
import type { QrCodesGateway } from '../ports'

export type UnbindResult = { ok: true } | { ok: false; error: 'code_not_found' }

export async function unbindCode(
  gw: QrCodesGateway,
  rawCode: string,
): Promise<UnbindResult> {
  const code = normalizeQrCode(rawCode)
  const { found } = await gw.unbind(code)
  if (!found) return { ok: false, error: 'code_not_found' }
  return { ok: true }
}
