import 'server-only'
import { testDb } from '@/shared/testing/e2e-db'

export type SeededQrCode = {
  code: string
  restaurantId: string | null
  label: string | null
}

export type SeedQrCodeInput = {
  code: string
  restaurantId?: string | null
  label?: string
}

/**
 * QR codes are cross-tenant (iedora-staff only). `restaurantId` is
 * optional — unbound rows model "printed, not yet assigned".
 */
export async function seedQrCode(input: SeedQrCodeInput): Promise<SeededQrCode> {
  const sql = testDb()
  const restaurantId = input.restaurantId ?? null
  await sql`
    INSERT INTO "menu"."qr_code" (code, restaurant_id, label, bound_at)
    VALUES (
      ${input.code},
      ${restaurantId},
      ${input.label ?? null},
      ${restaurantId ? new Date() : null}
    )
  `
  return { code: input.code, restaurantId, label: input.label ?? null }
}
