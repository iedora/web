// Asset target — every uploadable thing in the app maps to one of these.
// Targets are slug-scoped: the Go menu service derives storage keys and
// enforces ownership from the Bearer token + slug; the browser never sees
// raw storage identifiers beyond the presigned URL.
export type AssetTargetKind = 'restaurant-logo' | 'restaurant-banner' | 'item-photo'

export type AssetTarget =
  | { kind: 'restaurant-logo'; slug: string }
  | { kind: 'restaurant-banner'; slug: string }
  | { kind: 'item-photo'; slug: string; itemId: string }

/**
 * Client-side hints only — the Go service is the authority on size and
 * content-type limits (presign rejects violations). These let the UI
 * fail fast before a round-trip and render the "recommended" copy.
 */
export type UploadConstraints = {
  maxBytes: number
  acceptedMimeTypes: readonly string[]
  recommended?: { width: number; height: number; aspectLabel: string }
}
