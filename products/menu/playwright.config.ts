import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

// The bootstrap (Zitadel-shim) listens on this fixed port so menu's
// webServer can point at it deterministically. Playwright blocks on
// the URL below until the shim answers, so menu only boots once the
// testkit is ready. Keep this in sync with ZITADEL_ISSUER_URL in
// `.env.test`.
const SHIM_PORT = 4444
const SHIM_URL = `http://127.0.0.1:${SHIM_PORT}`

/**
 * Env contract for the E2E surface lives in `.env.test`. The
 * `test:e2e*` package.json scripts load it via `bun --env-file=.env.test`,
 * so by the time Playwright reads this config, process.env already has
 * every value the webServer + workers need. We forward process.env to
 * the webServer wholesale and only override NODE_ENV (Cache Components
 * need a production build).
 *
 * Spec discovery follows the vertical-slice convention (CLAUDE.md
 * rule 15): slice-local specs in `src/features/<slice>/e2e/**.spec.ts`
 * + cross-slice journeys in `tests/e2e/journeys/**.spec.ts`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: [
    'src/features/*/e2e/**/*.spec.ts',
    'tests/e2e/journeys/**/*.spec.ts',
  ],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: BASE_URL },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // CLAUDE.md rule 17: components expose `data-test-id`. Wire
    // `getByTestId()` to that attribute (Playwright's default is the
    // non-hyphenated `data-testid`).
    testIdAttribute: 'data-test-id',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: `SHIM_PORT=${SHIM_PORT} MENU_BASE_URL=${BASE_URL} bun run tests/e2e/_bootstrap.ts`,
      url: `${SHIM_URL}/.well-known/openid-configuration`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // CI runs the build in a dedicated step (so Playwright's webServer
      // only has to start it). Local does build + start in one shot.
      command: process.env.CI
        ? 'bun run start'
        : 'bun run build && bun run start',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    },
  ],
})
