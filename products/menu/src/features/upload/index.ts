/**
 * Public API of the upload slice.
 *
 * Server actions live at `@/features/upload/actions` (Next 'use server'
 * rules don't traverse barrels reliably). The `<ImageUpload>` client
 * component lives at `@/features/upload/ui/image-upload`. Storage itself
 * is owned by the Go menu service (presign → browser PUT → commit).
 */
export type { AssetTarget, AssetTargetKind, UploadConstraints } from './types'
export { TARGET_CONSTRAINTS } from './targets'
