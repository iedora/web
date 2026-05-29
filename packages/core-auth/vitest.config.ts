import { defineConfig } from 'vitest/config'

/**
 * Plain-node test surface. Tests run against the access-control taxonomy
 * (pure functions over the `statement` + role definitions) without booting
 * better-auth or hitting a database — that's verified at the consumer
 * layer (menu) with PGLite, not here.
 *
 * `server-only` is mocked — vitest runs as plain Node, not inside Next's
 * React Server Components context, so the `react-server` export condition
 * is never set. Without the mock, `server-only` throws unconditionally.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 5_000,
  },
  resolve: {
    alias: {
      'server-only': new URL('./__mocks__/server-only.mjs', import.meta.url).pathname,
    },
  },
})
