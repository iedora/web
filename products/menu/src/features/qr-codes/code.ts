/**
 * Sticker-code helpers. Codes can be either:
 *
 *   1. Custom — admin supplies the string (e.g. a code already printed on a
 *      physical sticker). Validated by `isValidQrCodeShape`.
 *   2. Generated — the admin asks for one. `generateQrCode()` returns an
 *      8-char Crockford-base32 string minus visually ambiguous glyphs
 *      (0/O, 1/I/L, U). 8 chars across 30 symbols ≈ 39 bits, ~5e11 codes —
 *      collision probability is microscopic for batches in the thousands;
 *      the PK uniqueness check at insert time is the final guard.
 *
 * Stickers may be printed mixed-case but we canonicalise to lower-case so
 * `/q/ABC` and `/q/abc` resolve to the same row.
 */

const ALPHABET = '23456789abcdefghjkmnpqrstvwxyz'
const GEN_LEN = 8
const MAX_LEN = 64
const SHAPE = /^[a-z0-9_-]+$/

export function generateQrCode(): string {
  const bytes = new Uint8Array(GEN_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < GEN_LEN; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

/**
 * Generate N distinct codes in memory. Within-batch dedup is best-effort
 * (the PK insert is the final authority). Returns exactly `n` codes for
 * any reasonable n — collisions before the dedup Set are astronomically
 * rare at this entropy.
 */
export function generateQrCodes(n: number): string[] {
  const out = new Set<string>()
  while (out.size < n) out.add(generateQrCode())
  return Array.from(out)
}

export function normalizeQrCode(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidQrCodeShape(raw: string): boolean {
  if (raw.length === 0 || raw.length > MAX_LEN) return false
  return SHAPE.test(raw)
}
