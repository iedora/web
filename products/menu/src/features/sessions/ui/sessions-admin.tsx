'use client'

import { useState, useTransition } from 'react'
import { Button, Table, Td, Th } from '@iedora/design-system'
import { revokeAllForUserAction, revokeSessionAction } from '../actions'

export type SessionAdminRow = {
  id: string
  userId: string
  email: string
  name: string
  roles: string[]
  permissions: string[]
  permissionsVersion: number
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  userAgent: string | null
  ipHashShort: string | null
  isOwnSession: boolean
}

/**
 * Cross-tenant sessions table — one row per active server-side session
 * across every org. Used by iedora-admin to triage abuse + nuke a user
 * everywhere on a grant change that needs immediate effect.
 *
 * UX rules:
 *   - The caller's OWN session is tagged "(this device)" so they don't
 *     accidentally revoke themselves into an OIDC bounce.
 *   - Per-row Revoke targets one sid. "Revoke all" targets every active
 *     session of that user_id.
 *   - We surface `permissions_version` — useful when checking that the
 *     webhook fan-out actually landed after a grant change.
 *
 * Rows come from `listAllActiveSessions()` already sorted by
 * last_seen_at desc; no client-side sort.
 */
export function SessionsAdmin({ rows }: { rows: SessionAdminRow[] }) {
  const userIds = Array.from(new Set(rows.map((r) => r.userId)))
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-55)]">
          Active sessions ({rows.length} across {userIds.length}{' '}
          {userIds.length === 1 ? 'user' : 'users'})
        </h2>
        <p className="text-xs text-[var(--ink-55)]">
          Snapshot — refresh to see new logins.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ink-55)]">No active sessions.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>SID</Th>
              <Th>Permissions</Th>
              <Th>Last seen</Th>
              <Th>Expires</Th>
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
            {row.email}
            {row.isOwnSession && (
              <span className="ml-2 text-xs text-[var(--cinnabar)]">
                (this device)
              </span>
            )}
          </span>
          <span className="font-mono text-[10px] text-[var(--ink-40)]">
            {row.userId}
          </span>
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
        <span className="font-mono text-[10px]">{row.lastSeenAt}</span>
      </Td>
      <Td>
        <span className="font-mono text-[10px]">{row.expiresAt}</span>
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

/**
 * Surface just the browser + OS hint from a User-Agent string. Full UAs
 * are noisy in a table; the operator usually only needs "Chrome / macOS"
 * not the full version triple.
 */
function shortUa(raw: string | null): string {
  if (!raw) return '—'
  const browser = /Chrome\/\d/.test(raw)
    ? 'Chrome'
    : /Safari\/\d/.test(raw) && !/Chrome/.test(raw)
      ? 'Safari'
      : /Firefox\/\d/.test(raw)
        ? 'Firefox'
        : 'Browser'
  const os = /Mac OS X/.test(raw)
    ? 'macOS'
    : /Windows/.test(raw)
      ? 'Windows'
      : /Linux/.test(raw)
        ? 'Linux'
        : ''
  return os ? `${browser} · ${os}` : browser
}

