/**
 * Narrow port for the qr-codes slice. The adapter is Drizzle-on-Postgres in
 * production; tests substitute a PGLite-backed implementation via the same
 * interface.
 *
 * Tenant scoping is INTENTIONALLY ABSENT — qr_code is a cross-tenant table
 * that only `iedora-admin` callers touch (see `requireIedoraAdmin` in
 * `@/features/auth`). Restaurant existence checks happen at the use-case
 * layer when binding, not here.
 */

export type QrCodeRow = {
  code: string
  restaurantId: string | null
  label: string | null
  createdAt: Date
  boundAt: Date | null
}

/**
 * Row shape used by the admin list view — joins restaurant for display
 * without round-tripping a second query per code.
 */
export type QrCodeListRow = QrCodeRow & {
  restaurant: { id: string; name: string; slug: string } | null
}

/**
 * Row shape used by the public resolver — only the bits the redirect
 * needs. Null when the code doesn't exist or is unbound.
 */
export type QrCodeResolved = {
  code: string
  restaurantSlug: string
}

export interface QrCodesGateway {
  /**
   * Insert one code. Caller has already validated shape + normalised to
   * lower-case. `boundAt` should be set when `restaurantId` is non-null.
   * Returns `duplicate: true` (no-op) when the PK already exists.
   */
  insertCode(input: {
    code: string
    restaurantId: string | null
    boundAt: Date | null
    label: string | null
  }): Promise<{ duplicate: boolean }>

  /**
   * Bulk-insert. Codes already known to be valid + normalised + distinct.
   * Conflicts on the PK are silently skipped; returns the codes that were
   * actually inserted so the caller can report N-of-M.
   */
  insertManyUnbound(codes: string[]): Promise<{ insertedCodes: string[] }>

  /** Returns `found: false` when the code doesn't exist. */
  bind(input: { code: string; restaurantId: string }): Promise<{ found: boolean }>

  /** Returns `found: false` when the code doesn't exist. */
  unbind(code: string): Promise<{ found: boolean }>

  /** Returns `found: false` when the code doesn't exist. */
  deleteCode(code: string): Promise<{ found: boolean }>

  /**
   * Full list — admin surface is small (printed-sticker registry), so we
   * don't paginate yet. Add a cursor here when batches grow past a screen.
   */
  list(): Promise<QrCodeListRow[]>

  /**
   * Public resolver. Returns the restaurant slug for a bound code, else
   * null. Used by `/q/[code]` — must be cheap; one indexed lookup.
   */
  resolveBound(code: string): Promise<QrCodeResolved | null>

  /**
   * Existence check used by the bind use-case to surface a friendly
   * "no such restaurant" error instead of bubbling up a FK violation.
   */
  restaurantExists(restaurantId: string): Promise<boolean>
}
