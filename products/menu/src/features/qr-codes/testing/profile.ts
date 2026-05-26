import { iedoraAdminProfile, type PermissionProfile } from '@/features/auth/testing'

/**
 * QR-codes admin surfaces require `iedora-admin`. Re-export the auth
 * slice's full-admin profile so qr-code specs declare intent without
 * tunneling through auth.
 */
export const qrCodesAdminProfile: PermissionProfile = iedoraAdminProfile
