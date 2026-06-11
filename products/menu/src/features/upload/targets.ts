import type { AssetTargetKind, UploadConstraints } from './types'

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Client-side constraint hints per target. Mirrors the Go menu service's
 * upload policy (services/internal/menu) — the server re-validates on
 * presign, so drift here only costs an extra round-trip, never a hole.
 */
export const TARGET_CONSTRAINTS: Record<AssetTargetKind, UploadConstraints> = {
  'restaurant-logo': {
    maxBytes: 2 * 1024 * 1024,
    acceptedMimeTypes: IMAGE_MIME,
    recommended: { width: 400, height: 400, aspectLabel: 'square' },
  },
  'restaurant-banner': {
    maxBytes: 5 * 1024 * 1024,
    acceptedMimeTypes: IMAGE_MIME,
    recommended: { width: 1600, height: 600, aspectLabel: 'wide (8:3)' },
  },
  'item-photo': {
    maxBytes: 3 * 1024 * 1024,
    acceptedMimeTypes: IMAGE_MIME,
    recommended: { width: 800, height: 800, aspectLabel: 'square' },
  },
}
