import Link from 'next/link'
import { getSession, requireIedoraAdmin } from '@/features/auth'
import { listAllActiveSessions } from '@/features/sessions'
import { SessionsAdmin } from '@/features/sessions/ui/sessions-admin'
import { toSessionAdminRow } from '@/features/sessions/ui/to-row'

/**
 * Cross-tenant session triage. iedora-admin only — the gate hides the
 * surface from tenant users (404 on missing role, no leak of existence).
 *
 * Read-side is a single PK-ordered query over `menu.session` (rows are
 * counted in tens, not millions); no pagination yet. When that becomes
 * a concern, add a `?user=<id>` filter and stream by `last_seen_at`.
 */
export default async function SessionsAdminPage() {
  await requireIedoraAdmin()

  const [records, current] = await Promise.all([
    listAllActiveSessions(),
    getSession(),
  ])

  const rows = records.map((r) =>
    toSessionAdminRow(r, current?.sid ?? null),
  )

  return (
    <div className="space-y-6">
      <h1 className="flex flex-wrap items-baseline gap-2 text-sm font-normal text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Back
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold">Sessions (admin)</span>
      </h1>

      <SessionsAdmin rows={rows} />
    </div>
  )
}
