import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

// The bootstrap process (testkit + genkan shim) listens on this fixed port
// so menu's webServer env can point at it deterministically. The matching
// `Playwright.webServer` entry blocks until this URL responds, so menu only
// boots once the testkit is ready.
const SHIM_PORT = 4444
const SHIM_URL = `http://127.0.0.1:${SHIM_PORT}`

const MENU_TEST_SECRET =
  'test-secret-do-not-use-in-prod-test-secret-do-not-use-in-prod'

export default defineConfig({
  testDir: './tests/e2e/specs',
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
    // Origin header is harmless on Next routes; carried over from the
    // earlier era where it was load-bearing for CSRF.
    extraHTTPHeaders: { Origin: BASE_URL },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Auto-cycle on the landing page is intentionally tested AS-IS — the
    // spec asserts the cycle is gated by prefers-reduced-motion. Tests
    // that don't care about animation can opt out per-test if needed.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // genkan-shim + auth-testkit. Bun runs the TypeScript bootstrap
      // directly. The shim writes its handle to
      // tests/e2e/.testkit.json once ready; Playwright keeps polling
      // `${SHIM_URL}/.well-known/openid-configuration` until 200.
      command: `SHIM_PORT=${SHIM_PORT} MENU_BASE_URL=${BASE_URL} bun run tests/e2e/_bootstrap.ts`,
      url: `${SHIM_URL}/.well-known/openid-configuration`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Must run a production build — Cache Components only behave correctly
      // under `next start`, not the dev server. In CI the build runs as a
      // dedicated step (with Node, not Bun — see AGENTS.md note on
      // oven-sh/bun#23944), so we skip the local `build` here to avoid a
      // double-build.
      command: process.env.CI
        ? 'bun run start'
        : 'bun run build && bun run start',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        DATABASE_URL:
          'postgresql://postgres:Password1!@localhost:5432/menu_test',
        MENU_PUBLIC_URL: BASE_URL,
        MENU_SESSION_SECRET: MENU_TEST_SECRET,
        DISABLE_RATE_LIMIT: 'true',
        // Zitadel-shaped wiring. The Zitadel testkit shim is not yet
        // restored after the #20 cutover; the values below let env.ts
        // pass its Zod gate so the dev-loop smoke + non-auth specs run.
        // Auth-coupled specs need a stub at SHIM_URL that answers
        // /.well-known/openid-configuration + /oauth/v2/* — see TODO in
        // tests/e2e/_bootstrap.ts.
        ZITADEL_ISSUER_URL: SHIM_URL,
        ZITADEL_OAUTH_CLIENT_ID: 'menu',
        ZITADEL_OAUTH_CLIENT_SECRET: 'menu-secret',
        ZITADEL_MANAGEMENT_TOKEN: 'test-pat',
        ZITADEL_ACTION_SIGNING_KEY: 'test-signing-key',
        // Storage — LocalStack via docker-compose. Separate bucket so tests
        // don't collide with dev assets.
        S3_ENDPOINT: 'http://localhost:4566',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: 'test',
        S3_SECRET_KEY: 'test',
        S3_BUCKET: 'menu-test',
        NODE_ENV: 'production',
      },
    },
  ],
})
