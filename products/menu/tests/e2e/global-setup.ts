import { truncateAll } from './helpers/db'

export default async function globalSetup() {
  console.log('[e2e global-setup] Cleaning test database...')
  try {
    await truncateAll()
  } catch (err) {
    console.warn('[e2e global-setup] DB truncation failed (might not be migrated yet):', err)
  }
}
