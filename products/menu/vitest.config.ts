import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // Unit tests live next to the code they test (co-located). `.test.tsx`
    // covers shared UI components rendered via `react-dom/server`.
    include: [
      'src/features/**/*.test.{ts,tsx}',
      'src/shared/**/*.test.{ts,tsx}',
    ],
    // Playwright owns e2e — keep them out of Vitest. `*.live.test.ts`
    // hits real third-party APIs (Kimi, etc.) and only runs through the
    // dedicated `test:ai-live` script.
    exclude: ['node_modules', 'tests/e2e/**', '.next', 'dist', '**/*.live.test.ts'],
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
