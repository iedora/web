import { defineConfig, globalIgnores } from 'eslint/config'
import { base, typescript, vitest } from '@iedora/eslint-config'

/**
 * @iedora/core-auth: better-auth wrapper + Drizzle schema. Node-only at runtime
 * (the auth instance owns its own Postgres connection). The client.ts
 * helper compiles to a browser bundle through the consumer's bundler;
 * we don't add a separate browser globals layer here — better-auth's
 * client uses fetch, available in every modern runtime.
 */
const eslintConfig = defineConfig([
  ...base(),
  ...typescript(),
  ...vitest(),
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  globalIgnores(['dist/**', 'drizzle/**', 'eslint.config.mjs']),
])

export default eslintConfig
