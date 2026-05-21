/**
 * Pure URL hygiene — no env, no `server-only`, no I/O. Sits alongside
 * `@/shared/url` (which holds `publicUrl()` — needs env) so that
 * consumers of the pure validator don't transitively load env.ts.
 *
 * Use on every user-supplied path before constructing a URL with it:
 * `?next=…`, `?return_url=…`, `redirect_uri=…`.
 */

/**
 * Returns true iff `raw` is a same-origin path the app can safely
 * redirect to. Rejects absolute URLs (`http://evil`), protocol-
 * relative URLs (`//evil`), and the `/\` bypass trick.
 */
export function isSameOriginPath(raw: string): boolean {
  if (!raw) return false
  if (!raw.startsWith('/')) return false
  if (raw.startsWith('//')) return false
  if (raw.startsWith('/\\')) return false
  return true
}
