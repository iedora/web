import { defineConfig, devices } from '@playwright/test'

/**
 * Unified E2E config for the iedora shell.
 *
 * One Playwright instance, one Next.js build, many products. Each
 * product owns a `project` matching specs under its slice e2e folders
 * (see testMatch below); cross-slice journeys live under each
 * product's tests/e2e/journeys folder. CI picks the projects to run
 * via `--project=<name>` based on changed paths; locally `bun run
 * test:e2e` runs every project.
 *
 * Env contract: `.env.test` co-located here is the superset every
 * product needs to build `apps/web` (better-auth + menu DB + S3 mock).
 * Loaded by the `test:e2e*` scripts via `bun --env-file=.env.test`.
 *
 * Spec discovery is glob-based across workspaces — adding a new
 * product = drop a `e2e/` folder under its slices + register a
 * project here. No new Playwright config, no new CI workflow.
 */

const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

const productProject = (name: string) => ({
  name,
  testDir: `../../products/${name}`,
  testMatch: [
    `src/features/*/e2e/**/*.spec.ts`,
    `tests/e2e/journeys/**/*.spec.ts`,
  ],
  use: { ...devices['Desktop Chrome'] },
})

export default defineConfig({
  testDir: '.',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: BASE_URL },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // CLAUDE.md rule 17: components expose `data-test-id` (hyphenated).
    testIdAttribute: 'data-test-id',
  },

  projects: [
    productProject('menu'),
    productProject('core'),
    productProject('imopush'),
  ],

  webServer: {
    // CI builds in a separate step; locally we build+start in one shot.
    command: process.env.CI ? 'bun run start' : 'bun run build && bun run start',
    url: BASE_URL,
    cwd: '.',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { ...process.env, NODE_ENV: 'production' },
  },
})
