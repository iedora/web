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
//                         folder: '/app/packages/core-auth/drizzle',
//                         tag: 'core' })
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Apply pending drizzle migrations against a single Postgres database.
 *
 * No-op (não erro) quando o workspace ainda não tem migrations geradas
 * — i.e. `meta/_journal.json` em falta. Permite que produtos scaffold
 * (ex: imopush no estado actual) participem do pipeline sem partir.
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
    console.log(`[migrate:${label}] sem migrations geradas (skip)`)
    return
  }
  if (!url) {
    console.error(`[migrate:${label}] connection URL em falta`)
    process.exit(1)
  }
  const sql = postgres(url, { max: 1 })
  try {
    console.log(`[migrate:${label}] ${url.replace(/:[^@]+@/, ':***@')} ← ${folder}`)
    await migrate(drizzle(sql), { migrationsFolder: folder })
    console.log(`[migrate:${label}] ok`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
