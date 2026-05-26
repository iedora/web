import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Vitest configuration for live AI integration tests. Off the default
 * test path because every run costs provider credits + needs network.
 * Invoke with `bun run test:ai-live`; the script also pipes `.env` so
 * the provider key lands in process.env.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.live.test.ts'],
    environment: 'node',
    pool: 'forks',
    // Live model calls can sit on the wire for a while.
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
})
