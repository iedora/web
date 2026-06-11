import { defineConfig, globalIgnores } from 'eslint/config'
import { base, typescript } from '@iedora/eslint-config'

const eslintConfig = defineConfig([
  ...base(),
  ...typescript(),
  globalIgnores(['dist/**', 'eslint.config.mjs']),
])

export default eslintConfig
