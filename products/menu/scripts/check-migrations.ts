/**
 * Dev-time guardrail. Compares the drizzle journal on disk against the
 * `drizzle.__drizzle_migrations` table and prints a warning when migrations are
 * pending — never blocks startup. The original failure mode this catches:
 * pulling main, running `bun run dev`, hitting an action that inserts into a
 * column the local DB doesn't have yet.
 *
 * Wired into `scripts.dev` in package.json so a stale schema is loud, not
 * silent. Safe to run with the DB down (it just skips the check).
 */

import postgres from 'postgres'
import journal from '../drizzle/meta/_journal.json' with { type: 'json' }

type JournalEntry = { idx: number; tag: string; when: number }

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) return

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 2,
    onnotice: () => {},
  })

  try {
    // Per-product tracker — see drizzle.config.ts. Menu's lives in
    // `menu.__drizzle_migrations` so it doesn't shadow any sibling
    // product sharing the database.
    const tableRows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'menu' AND table_name = '__drizzle_migrations'
      ) AS exists
    `
    const hasTable = tableRows[0]?.exists ?? false

    const applied = hasTable
      ? await sql<{ created_at: string }[]>`
          SELECT created_at FROM menu.__drizzle_migrations
        `
      : []
    const appliedSet = new Set(applied.map((a) => String(a.created_at)))

    const pending = (journal.entries as JournalEntry[]).filter(
      (e) => !appliedSet.has(String(e.when)),
    )

    if (pending.length === 0) return

    const list = pending.map((p) => `    - ${p.tag}`).join('\n')
    process.stderr.write(
      `\n\x1b[33m⚠  ${pending.length} pending migration(s):\n${list}\n\n   Run: bun run db:migrate\x1b[0m\n\n`,
    )
  } catch {
    // DB unreachable, schema not bootstrapped, etc. — non-fatal in dev.
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

main()
