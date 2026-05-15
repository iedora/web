import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // Unit tests live next to the code they test (co-located).
    include: ['src/features/**/*.test.ts', 'src/shared/**/*.test.ts'],
    // Playwright owns e2e — keep them out of Vitest.
    exclude: ['node_modules', 'tests/e2e/**', '.next', 'dist'],
    environment: 'node',
    pool: 'forks', // PGLite is per-worker; forks isolate cleanly.
    // PGLite WASM init is slow on first hit; give each test a reasonable budget.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Co-located tests means setup is per-feature; no global setup needed yet.
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
})
