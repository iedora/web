import { defineConfig, globalIgnores } from 'eslint/config'
import { next } from '@iedora/eslint-config'

/**
 * apps/web is a thin Next.js shell — every product page is a 1-line
 * re-export from @iedora/product-{menu,core,house}. The slice + boundary
 * rules belong with the products. Here we just keep the Next.js basics
 * (React + a11y + Next-specific recommendations).
 */
const eslintConfig = defineConfig([
  ...next(),
  globalIgnores(['.next/**', 'node_modules/**', 'eslint.config.mjs']),
])

export default eslintConfig
