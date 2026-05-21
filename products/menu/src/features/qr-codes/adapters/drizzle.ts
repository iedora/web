import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/shared/db/client'
import { qrCode, restaurant } from '@/shared/db/schema'
import type { QrCodesGateway } from '../ports'

/**
 * Production adapter. The qr-codes slice is admin-only (gated by
 * `requireIedoraAdmin`) so we don't apply tenant scoping here — that
 * happens at the use-case layer (none required, by design).
 *
 * Insert paths use `onConflictDoNothing()` on the PK so bulk import is
 * idempotent: re-running with overlapping codes does the right thing
 * instead of failing the whole batch.
 */
export const drizzleQrCodesGateway: QrCodesGateway = {
  async insertCode({ code, restaurantId, boundAt, label }) {
    const inserted = await db
      .insert(qrCode)
      .values({ code, restaurantId, boundAt, label })
      .onConflictDoNothing({ target: qrCode.code })
      .returning({ code: qrCode.code })
    return { duplicate: inserted.length === 0 }
  },

  async insertManyUnbound(codes) {
    if (codes.length === 0) return { insertedCodes: [] }
    const inserted = await db
      .insert(qrCode)
      .values(codes.map((c) => ({ code: c })))
      .onConflictDoNothing({ target: qrCode.code })
      .returning({ code: qrCode.code })
    return { insertedCodes: inserted.map((r) => r.code) }
  },

  async bind({ code, restaurantId }) {
    const rows = await db
      .update(qrCode)
      .set({ restaurantId, boundAt: new Date() })
      .where(eq(qrCode.code, code))
      .returning({ code: qrCode.code })
    return { found: rows.length > 0 }
  },

  async unbind(code) {
    const rows = await db
      .update(qrCode)
      .set({ restaurantId: null, boundAt: null })
      .where(eq(qrCode.code, code))
      .returning({ code: qrCode.code })
    return { found: rows.length > 0 }
  },

  async deleteCode(code) {
    const rows = await db
      .delete(qrCode)
      .where(eq(qrCode.code, code))
      .returning({ code: qrCode.code })
    return { found: rows.length > 0 }
  },

  async list() {
    // Left join — unbound rows still appear with restaurant=null.
    const rows = await db
      .select({
        code: qrCode.code,
        restaurantId: qrCode.restaurantId,
        label: qrCode.label,
        createdAt: qrCode.createdAt,
        boundAt: qrCode.boundAt,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
      })
      .from(qrCode)
      .leftJoin(restaurant, eq(qrCode.restaurantId, restaurant.id))
      .orderBy(desc(qrCode.createdAt))
    return rows.map((r) => ({
      code: r.code,
      restaurantId: r.restaurantId,
      label: r.label,
      createdAt: r.createdAt,
      boundAt: r.boundAt,
      restaurant:
        r.restaurantId && r.restaurantName && r.restaurantSlug
          ? { id: r.restaurantId, name: r.restaurantName, slug: r.restaurantSlug }
          : null,
    }))
  },

  async resolveBound(code) {
    const rows = await db
      .select({ code: qrCode.code, slug: restaurant.slug })
      .from(qrCode)
      .innerJoin(restaurant, eq(qrCode.restaurantId, restaurant.id))
      .where(eq(qrCode.code, code))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return { code: row.code, restaurantSlug: row.slug }
  },

  async restaurantExists(restaurantId) {
    const rows = await db
      .select({ id: restaurant.id })
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1)
    return rows.length > 0
  },
}
