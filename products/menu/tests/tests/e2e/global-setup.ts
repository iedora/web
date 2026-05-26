import { truncateAll } from '@/shared/testing/e2e-db'

/**
 * Runs once before the suite. Today this is a hygiene truncate — the
 * test DB is expected to exist with migrations applied (driven by the
 * dev stack: `just dev` or CI's pre-job migration step).
 *
 * When per-worker isolation is turned on (Phase 3, env
 * `MENU_TEST_ISOLATE_WORKERS=1`), this is where the template fork lives.
 */
export default async function globalSetup() {
  try {
    await truncateAll()
  } catch (err) {
    console.warn(
      '[e2e global-setup] DB truncation failed (likely not migrated yet):',
      err,
    )
  }
}
