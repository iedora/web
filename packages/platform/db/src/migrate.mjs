// @iedora/db/migrate — shared drizzle migration runner.
//
// Helper genérico: cada workspace com schema próprio invoca este via
// um migrate.mjs minimal que passa a sua URL + folder. Vive no data
// layer (não na presentation layer apps/web/) — single source of truth
// para o "como" das migrations.
//
// JavaScript puro (não .ts) — para correr directamente em Node em
// containers sem step de build/transpile. Importa drizzle-orm
// + postgres directamente do node_modules (instaladas no runtime stage
// do Dockerfile, fora do Next bundle).
//
// Uso programático:
//
//   import { runMigrations } from '../db/src/migrate.mjs'
//   await runMigrations({ url: process.env.CORE_DATABASE_URL,
//                         folder: '/app/packages/business/auth/drizzle',
//                         tag: 'core' })
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// Same server, maintenance `postgres` database — CREATE DATABASE can't run
// inside the target connection (nor in a transaction).
function adminUrlFor(connStr) {
  const u = new URL(connStr)
  u.pathname = '/postgres'
  return u.toString()
}

function dbNameFromUrl(connStr) {
  const u = new URL(connStr)
  return decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres'
}

/**
 * Idempotently create the target database if it's missing. This is why there
 * is no out-of-band `CREATE DATABASE` (no dev init.sql, no Coolify init
 * script): every migrate path creates its own database, so adding a new one
 * is just adding its migrate target. Mirrors scripts/run-migrations.mjs.
 *
 * @param {string} url    Target connection string.
 * @param {string} label  Log label.
 */
async function ensureDatabase(url, label) {
  const targetDb = dbNameFromUrl(url)
  const adminSql = postgres(adminUrlFor(url), { max: 1, onnotice: () => {} })
  try {
    const rows = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`
    if (rows.length === 0) {
      await adminSql.unsafe(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`)
      console.error(`[migrate:${label}] created database "${targetDb}"`)
    }
  } finally {
    await adminSql.end({ timeout: 5 })
  }
}

/**
 * Apply pending drizzle migrations against a single Postgres database.
 *
 * No-op (não erro) quando o workspace ainda não tem migrations geradas
 * — i.e. `meta/_journal.json` em falta. Permite que produtos scaffold
 * (ex: produtos novos) participem do pipeline sem partir.
 *
 * @param {object}  opts
 * @param {string}  opts.url    Postgres connection string. Vazio → exit 1.
 * @param {string}  opts.folder Abs path para pasta `drizzle/` com SQL files.
 * @param {string} [opts.tag]   Etiqueta para logs. Default: infer from path.
 * @returns {Promise<void>}
 */
export async function runMigrations({ url, folder, tag }) {
  const label = tag ?? folder.split('/').slice(-2, -1)[0] ?? 'db'
  if (!existsSync(join(folder, 'meta', '_journal.json'))) {
    console.warn(`[migrate:${label}] sem migrations geradas (skip)`)
    return
  }
  if (!url) {
    console.error(`[migrate:${label}] connection URL em falta`)
    process.exit(1)
  }
  await ensureDatabase(url, label)
  const sql = postgres(url, { max: 1 })
  try {
    console.error(`[migrate:${label}] ${url.replace(/:[^@]+@/, ':***@')} ← ${folder}`)
    await migrate(drizzle(sql), { migrationsFolder: folder })
    console.error(`[migrate:${label}] ok`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
