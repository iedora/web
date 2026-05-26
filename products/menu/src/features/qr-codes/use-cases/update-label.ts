import { normalizeQrCode } from '../code'
import type { QrCodesGateway } from '../ports'

export type UpdateLabelResult =
  | { ok: true }
  | { ok: false; error: 'code_not_found' | 'invalid_label' }

/**
 * Inline label edit from the admin registry. Trims whitespace; an empty
 * string clears the label (NULL in DB). Cap at 200 chars to keep the
 * column visually sane in the row.
 */
export async function updateLabel(
  gw: QrCodesGateway,
  input: { code: string; label: string },
): Promise<UpdateLabelResult> {
  const code = normalizeQrCode(input.code)
  const trimmed = input.label.trim()
  if (trimmed.length > 200) return { ok: false, error: 'invalid_label' }
  const label = trimmed.length === 0 ? null : trimmed
  const { found } = await gw.updateLabel({ code, label })
  if (!found) return { ok: false, error: 'code_not_found' }
  return { ok: true }
}
