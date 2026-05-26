import { defineConfig, globalIgnores } from 'eslint/config'
import { next, boundaries, vitest } from '@iedora/eslint-config'

/**
 * Menu's lint config — composes the shared @iedora/eslint-config factories.
 * Only the slice-element list lives here (slice paths are workspace-local);
 * the boundary rule body itself is shared.
 *
 * Cross-slice imports are policed: they must go through the target slice's
 * `index.ts` barrel or one of the sanctioned subpath entries
 * (actions, client, server, ui/**, rsc/**, testing, testing/**). See
 * AGENTS.md menu rule 14.
 *
 * `testing/**` is the slice's E2E surface (rule 15). The boundaries plugin
 * allows it cross-slice (so journeys can compose seeds + profiles), but
 * production code — anything outside `e2e/`, `testing/`, or unit tests —
 * must not import it. That extra guard is the `no-restricted-imports`
 * block below.
 */
const eslintConfig = defineConfig([
  ...next(),
  ...boundaries({
    elements: [
      { type: 'slice', pattern: 'src/features/*', capture: ['slice'] },
      { type: 'shared', pattern: 'src/shared/**' },
      { type: 'app', pattern: 'src/app/**' },
      { type: 'next-infra', pattern: 'src/i18n/**' },
      { type: 'next-infra', pattern: 'src/proxy.ts' },
    ],
  }),
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/features/*/e2e/**',
      'src/features/*/testing/**',
      'src/**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/*/testing',
                '@/features/*/testing/**',
                './testing',
                './testing/**',
                '../testing',
                '../testing/**',
                '../../testing',
                '../../testing/**',
              ],
              message:
                'testing/ surfaces are E2E-only (menu CLAUDE.md rule 15). Production code must not import them — move the helper into the slice proper, or design a port.',
            },
          ],
        },
      ],
    },
  },
  ...vitest(),
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'eslint.config.mjs']),
])

export default eslintConfig
