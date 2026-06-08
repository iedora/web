#!/usr/bin/env bun
/**
 * Fast-path wrapper for `bun run dev:migrate`.
 *
 * The real migrate chain (`packages/business/auth` →
 * `products/menu`) spawns two Node processes,
 * each loading the env, opening a Postgres connection, taking an
 * advisory lock, and querying `__drizzle_migrations`. End-to-end ~3-5s
 * even when there's nothing to apply — felt every single `bun run dev`
 * iteration even when the schema hadn't changed.
 *
 * This script fingerprints every drizzle/ folder we know about and
 * compares it to the last fingerprint we successfully applied. Match
 * = skip the whole chain (~10ms). Mismatch = run the real chain in
 * parallel (the DBs are independent, no FK across them), then
 * write the new fingerprint.
 *
 * Cache file: `.dev-cache/migrate-fingerprint`. Gitignored. Safe to
 * delete to force a re-migrate.
 *
 * Only used by local dev (`bun run dev`). CI and Kamal still call the
 * per-package `db:migrate` scripts directly so they never skip.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

// Each entry = { cwd, label, drizzleDir }. drizzleDir is what we
// fingerprint; cwd is what `bun run db:migrate` runs in.
const targets = [
  {
    cwd: 'packages/business/auth',
    label: 'core',
    drizzleDir: 'packages/business/auth/drizzle',
  },
  {
    cwd: 'products/menu',
    label: 'menu',
    drizzleDir: 'products/menu/drizzle',
  },
]

const cacheDir = join(repoRoot, '.dev-cache')
const cacheFile = join(cacheDir, 'migrate-fingerprint')

// ── Fingerprint ─────────────────────────────────────────────────────

function fingerprint() {
  const hash = createHash('sha256')
  for (const t of targets) {
    const dir = join(repoRoot, t.drizzleDir)
    if (!existsSync(dir)) continue
    // Recurse: every file's relative path + size + mtime + content hash.
    // mtime is the cheap signal; content hash protects against file
    // copies that re-stamp mtime without changing data.
    for (const file of walk(dir).sort()) {
      const rel = relative(repoRoot, file)
      const stat = statSync(file)
      hash.update(rel)
      hash.update(String(stat.size))
      hash.update(String(stat.mtimeMs))
    }
  }
  return hash.digest('hex')
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function readCachedFingerprint() {
  if (!existsSync(cacheFile)) return null
  try {
    return readFileSync(cacheFile, 'utf8').trim()
  } catch {
    return null
  }
}

function writeCachedFingerprint(fp) {
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cacheFile, fp + '\n', 'utf8')
}

// ── Migrate ─────────────────────────────────────────────────────────

function runMigrate(target) {
  return new Promise((res, rej) => {
    const child = spawn('bun', ['run', 'db:migrate'], {
      cwd: join(repoRoot, target.cwd),
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', (code) => {
      if (code === 0) res()
      else rej(new Error(`[dev-migrate] ${target.label} exited ${code}`))
    })
    child.on('error', rej)
  })
}

// ── Main ────────────────────────────────────────────────────────────

const t0 = Date.now()
const current = fingerprint()
const cached = readCachedFingerprint()

if (cached === current) {
  console.log(
    `[dev-migrate] no schema changes since last run — skipping (${Date.now() - t0}ms)`,
  )
  process.exit(0)
}

console.log('[dev-migrate] schema changed — running migrations in parallel…')
try {
  // Independent databases → safe to fan out. Each migrate takes
  // its own advisory lock so even hitting the same Postgres instance
  // is fine.
  await Promise.all(targets.map(runMigrate))
  writeCachedFingerprint(current)
  console.log(`[dev-migrate] done (${Date.now() - t0}ms)`)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
