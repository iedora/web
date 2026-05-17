import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Accessor for the testkit's resolved URL.
 *
 * The bootstrap process writes its handle to `tests/e2e/.testkit.json`
 * once the server is ready. `globalSetup` blocks until that file exists
 * (and bubbles its URL onto `process.env.E2E_TESTKIT_URL`). Test workers
 * also pick the URL straight from the file as a fallback, since the env
 * does not always propagate.
 */
const HANDLE_FILE = resolve(__dirname, '..', '.testkit.json')

type TestkitHandleFile = {
  url: string
  testkitUrl: string
  clientId: string
  clientSecret: string
}

let _cached: TestkitHandleFile | null = null

function read(): TestkitHandleFile {
  if (_cached) return _cached
  if (!existsSync(HANDLE_FILE)) {
    throw new Error(
      `[testkit] handle file missing at ${HANDLE_FILE} — did globalSetup run?`,
    )
  }
  _cached = JSON.parse(readFileSync(HANDLE_FILE, 'utf8')) as TestkitHandleFile
  return _cached
}

/** Returns the shim URL — what menu's `GENKAN_ISSUER_URL` points at. */
export function getTestkitUrl(): string {
  return process.env.E2E_TESTKIT_URL ?? read().url
}

/** Returns the trusted-client id the testkit pre-registered for menu. */
export function getMenuClientId(): string {
  return read().clientId
}

/**
 * Returns the UNDERLYING testkit URL (random port), NOT the shim. The
 * testkit listens on 127.0.0.1 but advertises itself as `http://localhost:<port>`,
 * which is what the shim's proxy forwards Location headers to. The browser
 * follows those redirects directly to the testkit, so any cookies set for
 * the shim origin (127.0.0.1:4444) don't accompany the request.
 *
 * Test code that needs to seed a Better Auth session for the OAuth flow
 * has to set the cookie for BOTH origins (shim + testkit) because Set-Cookie
 * domain rules treat `localhost` and `127.0.0.1` as different hosts.
 */
export function getUnderlyingTestkitUrl(): string {
  return read().testkitUrl
}
