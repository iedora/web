'use server'

import { revalidatePath } from 'next/cache'
import { requireScope } from '../auth'
import { SCOPES } from '@iedora/core-auth/scopes'
import { drizzleQrCodesGateway } from './adapters/drizzle'
import { bindCode as runBind } from './use-cases/bind'
import { bulkGenerate as runBulkGenerate } from './use-cases/bulk-generate'
import { createCode as runCreateCode } from './use-cases/create-code'
import { deleteCode as runDeleteCode } from './use-cases/delete-code'
import { unbindCode as runUnbind } from './use-cases/unbind'
import { updateLabel as runUpdateLabel } from './use-cases/update-label'

/**
 * Server actions for the admin QR-binding surface. Each action gates on
 * the scope that matches its verb — write for create/generate,
 * update for (un)bind, delete for removal. The slice has no tenant
 * scoping; the scope check is the only barrier between a logged-in
 * tenant user and the cross-tenant registry.
 *
 * Revalidation: the admin page is dynamic (it reads the gateway directly),
 * so we revalidate the admin route after every mutation. Public `/q/[code]`
 * isn't cached — no public revalidation needed.
 */

const ADMIN_PATH = '/menu/dashboard/admin/qr-codes'

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function errMsg(code: string): string {
  switch (code) {
    case 'invalid_shape':
      return 'Code must be 1–64 chars, letters/digits/_/- only.'
    case 'duplicate':
      return 'A code with that value already exists.'
    case 'invalid_count':
      return 'Count must be between 1 and 500.'
    case 'code_not_found':
      return 'No such code.'
    case 'restaurant_not_found':
      return 'No such restaurant.'
    case 'invalid_label':
      return 'Label must be 200 chars or fewer.'
    default:
      return 'Action failed.'
  }
}

export async function createCodeAction(input: {
  code?: string
  restaurantId?: string
  label?: string
}): Promise<ActionResult<{ code: string }>> {
  await requireScope(SCOPES.menu.tenant.qrCodes.create)
  const res = await runCreateCode(drizzleQrCodesGateway, input)
  if (!res.ok) return { ok: false, error: errMsg(res.error) }
  revalidatePath(ADMIN_PATH)
  return { ok: true, data: { code: res.code } }
}

export async function bulkGenerateAction(
  count: number,
): Promise<ActionResult<{ codes: string[] }>> {
  await requireScope(SCOPES.menu.tenant.qrCodes.create)
  const res = await runBulkGenerate(drizzleQrCodesGateway, { count })
  if (!res.ok) return { ok: false, error: errMsg(res.error) }
  revalidatePath(ADMIN_PATH)
  return { ok: true, data: { codes: res.codes } }
}

export async function bindCodeAction(input: {
  code: string
  restaurantId: string
}): Promise<ActionResult> {
  await requireScope(SCOPES.menu.tenant.qrCodes.update)
  const res = await runBind(drizzleQrCodesGateway, input)
  if (!res.ok) return { ok: false, error: errMsg(res.error) }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}

export async function unbindCodeAction(code: string): Promise<ActionResult> {
  await requireScope(SCOPES.menu.tenant.qrCodes.update)
  const res = await runUnbind(drizzleQrCodesGateway, code)
  if (!res.ok) return { ok: false, error: errMsg(res.error) }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}

export async function updateLabelAction(input: {
  code: string
  label: string
}): Promise<ActionResult> {
  await requireScope(SCOPES.menu.tenant.qrCodes.update)
  const res = await runUpdateLabel(drizzleQrCodesGateway, input)
  if (!res.ok) return { ok: false, error: errMsg(res.error) }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}

export async function deleteCodeAction(code: string): Promise<ActionResult> {
  await requireScope(SCOPES.menu.tenant.qrCodes.delete)
  const res = await runDeleteCode(drizzleQrCodesGateway, code)
  if (!res.ok) return { ok: false, error: errMsg(res.error) }
  revalidatePath(ADMIN_PATH)
  return { ok: true }
}
