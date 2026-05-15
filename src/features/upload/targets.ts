import type { AssetTarget, AssetTargetKind, UploadConstraints } from './types'

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const

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

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function extensionForMime(mime: string): string {
  return MIME_EXT[mime] ?? 'bin'
}

// Random suffix avoids browser/CDN caching the previous logo at the same URL.
function randomSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

export function buildKey(target: AssetTarget, mime: string): string {
  const ext = extensionForMime(mime)
  const slug = randomSlug()
  switch (target.kind) {
    case 'restaurant-logo':
      return `r/${target.restaurantId}/logo-${slug}.${ext}`
    case 'restaurant-banner':
      return `r/${target.restaurantId}/banner-${slug}.${ext}`
    case 'item-photo':
      return `r/${target.restaurantId}/items/${target.itemId}/${slug}.${ext}`
  }
}
