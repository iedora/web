/**
 * Extract the client IP, narrowed to a /64 for IPv6 so an attacker can't walk
 * a single /64 prefix to evade per-IP throttles (mitigates CVE-2026-45364).
 *
 * Only `cf-connecting-ip` is trusted: it is set by Cloudflare's edge and
 * stripped on incoming requests, so anything else (X-Forwarded-For,
 * X-Real-IP) is freely spoofable upstream of the tunnel. In dev/test we
 * fall back to `x-forwarded-for` so Playwright + Next dev still work.
 */
export function extractClientIp(req: Request): string | null {
  const raw =
    req.headers.get('cf-connecting-ip') ??
    (process.env.NODE_ENV !== 'production'
      ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      : null)
  if (!raw) return null
  return normalizeIp(raw, 64)
}

/**
 * IPv4 → return as-is. IPv6 → zero everything below the given prefix bit
 * count (default 64, the standard host-prefix boundary). Inputs are
 * trusted-shape (validated upstream by header parsing); on malformed
 * input we return the raw value to preserve "best-effort" semantics.
 */
export function normalizeIp(ip: string, ipv6Prefix: number = 64): string {
  if (!ip.includes(':')) return ip // IPv4 or empty

  const groups = expandIpv6(ip)
  if (!groups) return ip

  const bitsToKeep = Math.min(Math.max(ipv6Prefix, 0), 128)
  const fullGroups = Math.floor(bitsToKeep / 16)
  const remainder = bitsToKeep % 16

  const out = new Array<number>(8).fill(0)
  for (let i = 0; i < fullGroups; i++) out[i] = groups[i] ?? 0
  if (remainder > 0 && fullGroups < 8) {
    const mask = (0xffff << (16 - remainder)) & 0xffff
    out[fullGroups] = (groups[fullGroups] ?? 0) & mask
  }

  return out.map((g) => g.toString(16)).join(':')
}

/**
 * Expand a (possibly `::`-compressed) IPv6 string into 8 numeric groups.
 * Returns null for anything that doesn't look like IPv6 — caller falls
 * back to the raw string. Doesn't validate exhaustively (we trust the
 * upstream CF header).
 */
function expandIpv6(ip: string): number[] | null {
  // Split on `::` (at most one). Each side is a colon-joined list of
  // hex groups.
  const halves = ip.split('::')
  if (halves.length > 2) return null

  const parseSide = (side: string): number[] =>
    side === '' ? [] : side.split(':').map((g) => parseInt(g, 16))

  const left = parseSide(halves[0] ?? '')
  const right = halves.length === 2 ? parseSide(halves[1] ?? '') : []

  if (left.some(isNaN) || right.some(isNaN)) return null

  const fill = 8 - left.length - right.length
  if (fill < 0) return null
  return [...left, ...new Array(fill).fill(0), ...right]
}
