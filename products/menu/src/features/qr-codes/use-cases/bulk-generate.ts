import { generateQrCodes } from '../code'
import type { QrCodesGateway } from '../ports'

const MAX_BATCH = 500

export type BulkGenerateInput = { count: number }

export type BulkGenerateResult =
  | { ok: true; codes: string[] }
  | { ok: false; error: 'invalid_count' }

/**
 * Auto-generate N unbound codes in one call. Capped at MAX_BATCH so a
 * runaway form never tries to mint 100k rows in a single tx.
 *
 * Any in-flight PK collision is silently skipped by the gateway (rare at
 * this entropy); we return the codes that actually landed.
 */
export async function bulkGenerate(
  gw: QrCodesGateway,
  input: BulkGenerateInput,
): Promise<BulkGenerateResult> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BATCH) {
    return { ok: false, error: 'invalid_count' }
  }
  const codes = generateQrCodes(input.count)
  const { insertedCodes } = await gw.insertManyUnbound(codes)
  return { ok: true, codes: insertedCodes }
}
