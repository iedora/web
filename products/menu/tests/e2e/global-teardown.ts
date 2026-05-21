import { closeTestDb } from './helpers/db'

export default async function globalTeardown() {
  console.log('[e2e global-teardown] Tearing down resources...')
  await closeTestDb()
}
