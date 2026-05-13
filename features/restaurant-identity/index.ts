/**
 * Public API of the restaurant-identity slice.
 *
 * Server actions live at `@/features/restaurant-identity/actions` (Next
 * 'use server' rules don't traverse barrels reliably). The client UI lives
 * at `@/features/restaurant-identity/ui/*` and is imported directly.
 */
export type { IdentityWritePort } from './ports'
