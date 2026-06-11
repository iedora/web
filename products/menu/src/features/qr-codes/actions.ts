'use server'

import { revalidatePath } from 'next/cache'
import { ApiError } from '@iedora/api-client'
import * as api from '../../shared/api'
import { generateQrCode, isValidQrCodeShape, normalizeQrCode } from './code'

/**
 * Server actions for the staff QR-binding surface — thin wrappers over
 * the Go menu service's `/api/staff/qr-codes` endpoints. The service
 * enforces the staff role on the Bearer token (a tenant user gets a
 * 403 translated into `{ ok: false }`); the only client-side logic
 * kept here is code normalisation + shape validation so typos fail
 * fast with a friendly message.
 *
 * Revalidation: the admin page is dynamic, so we revalidate the admin
 * route after every mutation. Public `/q/[code]` isn't cached — no
 * public revalidation needed.
 */

const ADMIN_PATH = '/menu/dashboard/admin/qr-codes'

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Action failed.'
}

export async function createCodeAction(input: {
  code?: string
  restaurantId?: string
  label?: string
}): Promise<ActionResult<{ code: string }>> {
  // Generate client-side when no code is supplied — the Go endpoint
  // reports only an inserted count, and the form wants to echo the
  // created code back to the operator.
  let code: string
  if (input.code !== undefined) {
    code = normalizeQrCode(input.code)
    if (!isValidQrCodeShape(code)) {
      return { ok: false, error: 'Code must be 1–64 chars, letters/digits/_/- only.' }
    }
  } else {
    code = generateQrCode()
  }
  try {
    const { inserted } = await api.createQRCodes({
      code,
      restaurantId: input.restaurantId,
      label: input.label?.trim() || undefined,
    })
    if (inserted === 0) {
      return { ok: false, error: 'A code with that value already exists.' }
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidatePath(ADMIN_PATH)
  return { ok: true, data: { code } }
}

export async function bulkGenerateAction(
  count: number,
): Promise<ActionResult<{ count: number }>> {
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return { ok: false, error: 'Count must be between 1 and 500.' }
  }
  try {
    const { inserted } = await api.createQRCodes({ count })
    revalidatePath(ADMIN_PATH)
    return { ok: true, data: { count: inserted } }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function bindCodeAction(input: {
  code: string
  restaurantId: string
}): Promise<ActionResult> {
  try {
    await api.bindQRCode(normalizeQrCode(input.code), input.restaurantId)
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}

export async function unbindCodeAction(code: string): Promise<ActionResult> {
  try {
    await api.unbindQRCode(normalizeQrCode(code))
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}

export async function updateLabelAction(input: {
  code: string
  label: string
}): Promise<ActionResult> {
  const label = input.label.trim()
  if (label.length > 200) {
    return { ok: false, error: 'Label must be 200 chars or fewer.' }
  }
  try {
    await api.labelQRCode(normalizeQrCode(input.code), label)
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}

export async function deleteCodeAction(code: string): Promise<ActionResult> {
  try {
    await api.deleteQRCode(normalizeQrCode(code))
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}
