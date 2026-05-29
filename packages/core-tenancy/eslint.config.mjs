import { defineConfig, globalIgnores } from 'eslint/config'
import { base, typescript, vitest } from '@iedora/eslint-config'

/**
 * @iedora/core-tenancy: cross-product tenant state projection. Node-only
 * at runtime — shares the core Postgres connection via @iedora/core-auth.
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
      },
    },
  },
  globalIgnores(['dist/**', 'eslint.config.mjs']),
])

export default eslintConfig
