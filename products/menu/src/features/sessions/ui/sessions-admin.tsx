'use client'

import { useState, useTransition } from 'react'
import { Button, Table, Td, Th } from '@iedora/design-system'
import { Histogram, Stat, StatsPanel } from '@/shared/ui/admin-stats'
import { revokeAllForUserAction, revokeSessionAction } from '../actions'
import type { AuthMethod, ZitadelUserState } from '../adapters/zitadel-enrichment'
import type { SessionStats } from '../stats'

export type SessionAdminRow = {
  id: string
  userId: string
  email: string
  displayName: string
  username: string | null
  state: ZitadelUserState | null
  emailVerified: boolean | null
  roles: string[]
  permissions: string[]
  permissionsVersion: number
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  userAgent: string | null
  ipHashShort: string | null
  authMethods: AuthMethod[]
  isOwnSession: boolean
}

/**
 * Re-export only — the page does the projection in `to-row.ts`.
 */
export type { ZitadelUserState }

/**
 * Cross-tenant sessions table — one row per active server-side session
 * across every org, with Zitadel enrichment (display name, state, MFA
 * methods) layered on top so the operator can triage without a tab
 * switch to Zitadel's console.
 *
 * UX rules:
 *   - The caller's OWN session is tagged "(this device)" and a confirm
 *     dialog warns before revoke (you'd boot yourself).
 *   - User-state badges flag accounts that need attention (locked /
 *     initial / inactive).
 *   - The header row is a stats strip: total / unique users / new in
 *     last 24h / stale / avg age / browser breakdown.
 *
 * Rows arrive pre-sorted by `last_seen_at` desc.
 */
export function SessionsAdmin({
  rows,
  stats,
  snapshotAt,
}: {
  rows: SessionAdminRow[]
  stats: SessionStats
  /** ISO timestamp of when the snapshot was taken (server side). */
  snapshotAt: string
}) {
  return (
    <div className="space-y-6">
      <SessionsStatsPanel stats={stats} snapshotAt={snapshotAt} />
      <SessionsTable rows={rows} />
    </div>
  )
}

// ── Stats panel ─────────────────────────────────────────────────────────────

function SessionsStatsPanel({
  stats,
  snapshotAt,
}: {
  stats: SessionStats
  snapshotAt: string
}) {
  const avg = Number.isNaN(stats.avgAgeHours)
    ? '—'
    : stats.avgAgeHours < 1
      ? `${Math.round(stats.avgAgeHours * 60)}m`
      : `${stats.avgAgeHours.toFixed(1)}h`

  return (
    <StatsPanel
      title="Overview"
      snapshotAt={snapshotAt}
      stats={[
        <Stat key="total" label="Sessions" value={String(stats.total)} />,
        <Stat key="users" label="Users" value={String(stats.uniqueUsers)} />,
        <Stat
          key="new"
          label="New 24h"
          value={String(stats.last24h)}
          hint={stats.last24h > 0 ? 'logins' : 'none'}
        />,
        <Stat
          key="stale"
          label="Stale > 24h"
          value={String(stats.staleCount)}
          tone="warn"
        />,
        <Stat key="age" label="Avg age" value={avg} hint="since last seen" />,
        <Stat
          key="perm"
          label="Max perm. v"
          value={String(stats.permissionVersionMax)}
          hint="webhook bumps"
        />,
      ]}
      histograms={[
        <Histogram key="browsers" label="Browsers" entries={stats.browsers} />,
        <Histogram
          key="os"
          label="Operating systems"
          entries={stats.operatingSystems}
        />,
      ]}
    />
  )
}

// ── Sessions table ─────────────────────────────────────────────────────────

function SessionsTable({ rows }: { rows: SessionAdminRow[] }) {
  const userIds = Array.from(new Set(rows.map((r) => r.userId)))
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
          Active sessions ({rows.length} across {userIds.length}{' '}
          {userIds.length === 1 ? 'user' : 'users'})
        </h2>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ink-55)]">No active sessions.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Account</Th>
              <Th>SID</Th>
              <Th>Permissions</Th>
              <Th>Last seen</Th>
              <Th>Client</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SessionRow key={row.id} row={row} />
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}

function SessionRow({ row }: { row: SessionAdminRow }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  function onRevoke() {
    if (row.isOwnSession) {
      const ok = confirm(
        'This is YOUR session. Revoking will log you out and bounce you through OIDC. Continue?',
      )
      if (!ok) return
    }
    setError(null)
    setStatus(null)
    startTransition(async () => {
      const res = await revokeSessionAction(row.id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setStatus('Revoked — row will disappear on next refresh.')
    })
  }

  function onRevokeAll() {
    const ok = confirm(
      `Revoke EVERY active session for ${row.email}? This logs them out on every device.`,
    )
    if (!ok) return
    setError(null)
    setStatus(null)
    startTransition(async () => {
      const res = await revokeAllForUserAction(row.userId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setStatus(`Revoked ${'count' in res ? res.count : 0} session(s).`)
    })
  }

  return (
    <tr>
      <Td>
        <div className="flex flex-col">
          <span className="text-sm">
            {row.displayName}
            {row.isOwnSession && (
              <span className="ml-2 text-xs text-[var(--cinnabar)]">
                (this device)
              </span>
            )}
          </span>
          <span className="text-xs text-[var(--ink-55)]">{row.email}</span>
          {row.username && row.username !== row.email && (
            <span className="font-mono text-[10px] text-[var(--ink-40)]">
              {row.username}
            </span>
          )}
        </div>
      </Td>
      <Td>
        <div className="flex flex-col gap-1">
          <StateBadge state={row.state} />
          {row.emailVerified === false && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--cinnabar)]">
              email unverified
            </span>
          )}
          <MfaBadges methods={row.authMethods} />
        </div>
      </Td>
      <Td>
        <span className="font-mono text-[10px]">{row.id.slice(0, 12)}…</span>
      </Td>
      <Td>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs">
            {row.permissions.length === 0
              ? '—'
              : `${row.permissions.length} scope${row.permissions.length === 1 ? '' : 's'}`}
          </span>
          {row.roles.length > 0 && (
            <span className="font-mono text-[10px] text-[var(--ink-55)]">
              {row.roles.join(', ')}
            </span>
          )}
          <span className="font-mono text-[10px] text-[var(--ink-40)]">
            v{row.permissionsVersion}
          </span>
        </div>
      </Td>
      <Td>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px]">{row.lastSeenAt}</span>
          <span className="font-mono text-[10px] text-[var(--ink-40)]">
            exp {row.expiresAt}
          </span>
        </div>
      </Td>
      <Td>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs">{shortUa(row.userAgent)}</span>
          {row.ipHashShort && (
            <span
              className="font-mono text-[10px] text-[var(--ink-40)]"
              title="SHA-256 of client IP, truncated"
            >
              ip:{row.ipHashShort}
            </span>
          )}
        </div>
      </Td>
      <Td>
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="ghost"
            type="button"
            onClick={onRevoke}
            disabled={pending}
          >
            Revoke
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={onRevokeAll}
            disabled={pending}
          >
            Revoke all (user)
          </Button>
          {error && (
            <span className="text-[10px] text-[var(--cinnabar)]">{error}</span>
          )}
          {status && (
            <span className="text-[10px] text-[var(--ink-55)]">{status}</span>
          )}
        </div>
      </Td>
    </tr>
  )
}

function StateBadge({ state }: { state: ZitadelUserState | null }) {
  if (!state || state === 'unknown') {
    return (
      <span
        className="inline-flex items-center font-[family-name:var(--mono)] text-[10px] uppercase tracking-wider text-[var(--ink-40)]"
        title="Zitadel state unavailable"
      >
        — state
      </span>
    )
  }
  const tone =
    state === 'active'
      ? 'text-[var(--ink)]'
      : state === 'inactive'
        ? 'text-[var(--ink-55)]'
        : 'text-[var(--cinnabar)]'
  return (
    <span
      className={`inline-flex items-center font-[family-name:var(--mono)] text-[10px] uppercase tracking-wider ${tone}`}
      title="Zitadel user state"
    >
      ● {state}
    </span>
  )
}

function MfaBadges({ methods }: { methods: AuthMethod[] }) {
  const mfa = methods.filter((m) => m !== 'password' && m !== 'idp')
  if (mfa.length === 0) {
    return (
      <span
        className="font-[family-name:var(--mono)] text-[10px] uppercase tracking-wider text-[var(--cinnabar)]"
        title="No MFA factor enrolled"
      >
        no MFA
      </span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {mfa.map((m) => (
        <span
          key={m}
          className="inline-flex items-center border border-[var(--ink-14)] px-1.5 py-0.5 font-[family-name:var(--mono)] text-[9px] uppercase tracking-wider text-[var(--ink)]"
        >
          {m.replace('_', ' ')}
        </span>
      ))}
    </div>
  )
}

/**
 * Browser/OS hint — same logic as `stats.ts::parseBrowser/parseOs`,
 * kept here for a single rendered string per row. Keep in sync.
 */
function shortUa(raw: string | null): string {
  if (!raw) return '—'
  const browser = /Edg\/\d/.test(raw)
    ? 'Edge'
    : /OPR\/\d/.test(raw)
      ? 'Opera'
      : /Chrome\/\d/.test(raw)
        ? 'Chrome'
        : /Firefox\/\d/.test(raw)
          ? 'Firefox'
          : /Safari\/\d/.test(raw) && !/Chrome/.test(raw)
            ? 'Safari'
            : 'Browser'
  const os = /iPhone|iPad/.test(raw)
    ? 'iOS'
    : /Android/.test(raw)
      ? 'Android'
      : /Mac OS X/.test(raw)
        ? 'macOS'
        : /Windows/.test(raw)
          ? 'Windows'
          : /Linux/.test(raw)
            ? 'Linux'
            : ''
  return os ? `${browser} · ${os}` : browser
}
