import { isValidQrCodeShape, normalizeQrCode } from '../code'
import type { QrCodeResolved, QrCodesGateway } from '../ports'

/**
 * Public-path resolver. Cheap shape gate first so garbage URLs never touch
 * the DB; then a single indexed lookup. Returns null for unknown codes and
 * for known-but-unbound codes alike — callers (the `/q/[code]` route) 404
 * in both cases.
 */
export async function resolveCode(
  gw: QrCodesGateway,
  rawCode: string,
): Promise<QrCodeResolved | null> {
  const code = normalizeQrCode(rawCode)
  if (!isValidQrCodeShape(code)) return null
  return gw.resolveBound(code)
}
