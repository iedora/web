import { closeTestDb } from '@/shared/testing/e2e-db'

export default async function globalTeardown() {
  await closeTestDb()
}
