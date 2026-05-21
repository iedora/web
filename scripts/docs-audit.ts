#!/usr/bin/env bun
/**
 * Doc maintenance gate. Grep-based, deterministic, token-free.
 *
 * Catches the three drift modes a Doc Maintainer would flag:
 *
 *   1. **Dead references** — docs pointing at paths that no longer exist
 *      (e.g. `tests/e2e/specs/` after the slice-E2E refactor).
 *   2. **Stale claims** — phrases the codebase has invalidated
 *      (e.g. "no local user/session table" after the menu.session cutover).
 *   3. **Convention drift** — docs that reference rules of the wrong
 *      version (e.g. "5 sanctioned subpaths" when the rule says 6).
 *
 * Designed to run in <1s and produce a clean PR-comment-style report.
 * Exits 1 on any finding. Run locally with `bun run docs:audit` or in CI.
 *
 * Adding a check: append a `Check` to `CHECKS`. Each check has a `name`,
 * a `find` (pattern), and either a `forbid` (any match = finding) or a
 * `require` (no match = finding). `paths` narrows the scope.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

type Check = {
  /** Human-readable name. */
  name: string
  /** Why this check exists. Surfaced in the failure report. */
  reason: string
  /** Substring or RegExp the check runs against each file's content. */
  find: string | RegExp
  /** "forbid": any match is a finding; "require": no match is a finding. */
  mode: 'forbid' | 'require'
  /** File-glob root prefixes (relative to repo root) the check scopes to. */
  paths: string[]
  /** Suggested fix shown to the user when the check fires. */
  fix: string
}

const CHECKS: Check[] = [
  {
    name: 'tests/e2e/specs/ is gone',
    reason: 'The slice-E2E refactor moved specs to src/features/<slice>/e2e/.',
    find: /tests\/e2e\/specs\//,
    mode: 'forbid',
    paths: ['docs', 'AGENTS.md', 'products/menu/CLAUDE.md'],
    fix: 'Replace with src/features/<slice>/e2e/ (or tests/e2e/journeys/ for cross-slice).',
  },
  {
    name: 'tests/e2e/helpers/db.ts is gone',
    reason: 'DB primitives moved to src/shared/testing/e2e-db.ts.',
    find: 'tests/e2e/helpers/db.ts',
    mode: 'forbid',
    paths: ['docs', 'AGENTS.md', 'products/menu/CLAUDE.md', 'products/menu/src'],
    fix: 'Replace with @/shared/testing/e2e-db.',
  },
  {
    name: 'tests/e2e/helpers/sign-in.ts is gone',
    reason: 'signInAs moved to src/features/auth/testing/sign-in.ts.',
    find: 'tests/e2e/helpers/sign-in.ts',
    mode: 'forbid',
    paths: ['docs', 'AGENTS.md', 'products/menu/CLAUDE.md', 'products/menu/src'],
    fix: 'Replace with @/features/auth/testing.',
  },
  {
    name: 'old session-table claim',
    reason:
      'Post-#21 cutover, menu.session is the authoritative row; only the cookie is JWE.',
    find: /no local user\/session table/i,
    mode: 'forbid',
    paths: ['AGENTS.md', 'products/menu/CLAUDE.md', 'docs'],
    fix:
      'Update to "menu.session is the authoritative state; the cookie carries only {sid, sub, exp}".',
  },
  {
    name: 'LocalStack in CI is wrong',
    reason: 'CI uses adobe/s3mock since the LocalStack :latest paid-licence shift.',
    find: /LocalStack in CI/,
    mode: 'forbid',
    paths: ['docs', 'AGENTS.md', 'products/menu/CLAUDE.md', 'products/menu/src'],
    fix: 'Use "LocalStack in dev, adobe/s3mock in CI".',
  },
  {
    name: 'CLAUDE.md rule count matches AGENTS.md',
    reason: 'AGENTS.md advertises "N rules" — keep it in sync with menu/CLAUDE.md.',
    find: /15 rules/,
    mode: 'require',
    paths: ['AGENTS.md'],
    fix: 'Bump the rule count in AGENTS.md (or trim CLAUDE.md back to match).',
  },
  {
    name: 'CLAUDE.md rule 14 lists six sanctioned subpaths',
    reason: 'Rule 14 must list testing/ alongside actions/client/server/ui/rsc.',
    find: /Six\*?\*? sanctioned exceptions/,
    mode: 'require',
    paths: ['products/menu/CLAUDE.md'],
    fix: 'Confirm rule 14 says "Six sanctioned exceptions" and includes testing/.',
  },
]

const TEXT_EXT = /\.(md|mdx|tsx?|jsx?|mjs|cjs|json|yml|yaml|sh)$/i
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'out',
  '.turbo',
  '.bun',
  '.cache',
  'drizzle',
  '.terraform',
])

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(full)
    } else if (TEXT_EXT.test(entry)) {
      yield full
    }
  }
}

function isInScope(file: string, scopes: string[]): boolean {
  const rel = relative(ROOT, file)
  return scopes.some((s) => rel === s || rel.startsWith(s + sep))
}

type Finding = {
  check: Check
  file: string
  line: number
  excerpt: string
}

function runCheck(check: Check): Finding[] {
  const findings: Finding[] = []
  const filesInScope: string[] = []
  for (const file of walk(ROOT)) {
    if (!isInScope(file, check.paths)) continue
    filesInScope.push(file)
  }

  if (check.mode === 'require') {
    // The pattern must appear in AT LEAST ONE in-scope file.
    let found = false
    for (const file of filesInScope) {
      const content = readFileSync(file, 'utf8')
      if (matchOnce(content, check.find)) {
        found = true
        break
      }
    }
    if (!found) {
      findings.push({
        check,
        file: '(scope)',
        line: 0,
        excerpt: check.paths.join(', '),
      })
    }
    return findings
  }

  // forbid mode: any match is a finding.
  for (const file of filesInScope) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (matchOnce(lines[i]!, check.find)) {
        findings.push({
          check,
          file: relative(ROOT, file),
          line: i + 1,
          excerpt: lines[i]!.trim().slice(0, 120),
        })
      }
    }
  }
  return findings
}

function matchOnce(text: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') return text.includes(pattern)
  return pattern.test(text)
}

function main(): void {
  const all: Finding[] = []
  for (const c of CHECKS) all.push(...runCheck(c))

  if (all.length === 0) {
    console.log('✓ docs-audit clean — no drift detected.')
    return
  }

  const byCheck = new Map<string, Finding[]>()
  for (const f of all) {
    const arr = byCheck.get(f.check.name) ?? []
    arr.push(f)
    byCheck.set(f.check.name, arr)
  }

  console.error(`✗ docs-audit found ${all.length} finding(s):\n`)
  for (const [name, findings] of byCheck) {
    const first = findings[0]!
    console.error(`### ${name}`)
    console.error(`  Why:  ${first.check.reason}`)
    console.error(`  Fix:  ${first.check.fix}`)
    for (const f of findings) {
      if (f.line === 0) {
        console.error(`    (no occurrence in: ${f.excerpt})`)
      } else {
        console.error(`    ${f.file}:${f.line}  ${f.excerpt}`)
      }
    }
    console.error('')
  }
  process.exit(1)
}

main()
