// Asset target — every uploadable thing in the app maps to one of these.
// Adding a new target means: extend this union, add a TARGET_CONSTRAINTS entry
// in targets.ts, and add a `commitAsset` branch in the upload action.
export type AssetTargetKind =
  | 'restaurant-logo'
  | 'restaurant-banner'
  | 'item-photo'

export type AssetTarget =
  | { kind: 'restaurant-logo'; restaurantId: string }
  | { kind: 'restaurant-banner'; restaurantId: string }
  | { kind: 'item-photo'; restaurantId: string; itemId: string }

export type UploadConstraints = {
  maxBytes: number
  acceptedMimeTypes: readonly string[]
  recommended?: { width: number; height: number; aspectLabel: string }
}

export type PresignedUploadRequest = {
  contentType: string
  contentLengthBytes: number
}

export type PresignedUpload = {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresInSeconds: number
}

// Storage interface — this is the slice's port. Implementations live under
// `./adapters/`. Server actions depend on this, never on a concrete SDK.
// Swap MinIO for R2/S3 in prod by changing only `./adapters/factory.ts`.
export interface Storage {
  presignPut(key: string, req: PresignedUploadRequest): Promise<PresignedUpload>
  delete(key: string): Promise<void>
  // Inverse of `publicUrl` returned by presignPut. Returns null when the URL
  // didn't originate from this storage (e.g. a hand-pasted external URL the
  // user had before uploads existed). Callers use this to know what to delete
  // when replacing an asset.
  keyFromPublicUrl(url: string): string | null
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}
