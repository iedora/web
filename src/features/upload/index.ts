/**
 * Public API of the upload slice.
 *
 * Server actions live at `@/features/upload/actions` (Next 'use server' rules
 * don't traverse barrels reliably). The `<ImageUpload>` client component
 * lives at `@/features/upload/ui/image-upload`. The asset-target registry
 * (`targets.ts`) is slice-private — callers should not depend on it.
 */
export type { Storage } from './types'
export { getStorage } from './adapters/factory'
export { ensureBucket } from './adapters/bootstrap'
