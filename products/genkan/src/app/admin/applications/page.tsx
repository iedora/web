import Link from 'next/link'
import {
  Badge,
  EmptyState,
  Table,
  TableRowNum,
  Td,
  Th,
} from '@iedora/design-system'
import { requireAdmin } from '@/features/admin'
import { listApplications } from '@/features/admin/use-cases/list-applications'
import { getLatestJwksKeyInfo } from '@/features/auth/use-cases/rotate-jwks'
import { PageHead, Mono, SectionRule } from '../_lib/editorial'
import { SearchBox } from '../_lib/search-box'
import {
  RegisterApplicationDialog,
  RotateJwksDialog,
} from './applications-actions.client'

export const metadata = { title: 'Applications · Admin' }

type SearchParams = Promise<{ q?: string }>

function fmtDate(d: Date | null) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-CA').format(d)
}

function fmtDateTime(d: Date | null) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d)
}

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireAdmin('/admin/applications')
  const { q } = await searchParams
  const [apps, jwksInfo] = await Promise.all([
    listApplications({ search: q }),
    getLatestJwksKeyInfo(),
  ])

  return (
    <>
      <PageHead
        eyebrow="/ 03  Applications"
        title="OAuth clients."
        note="Registered clients that may complete an OIDC handshake. First-party apps are pre-registered through TRUSTED_CLIENTS."
        actions={
          <>
            <SearchBox placeholder="Search by name or client_id" />
            <RegisterApplicationDialog />
          </>
        }
      />

      {apps.length === 0 ? (
        <EmptyState
          label="No applications"
          note={q ? `Nothing matches “${q}”.` : 'No clients registered yet.'}
        />
      ) : (
        <div className="admin-table-scroll"><Table>
          <thead>
            <tr>
              <Th style={{ width: '4ch' }}>N</Th>
              <Th>Name</Th>
              <Th>Client ID</Th>
              <Th>Redirect URIs</Th>
              <Th>Scope</Th>
              <Th>Trusted</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a, i) => (
              <tr key={a.id}>
                <Td>
                  <TableRowNum>{String(i + 1).padStart(2, '0')}</TableRowNum>
                </Td>
                <Td>
                  <Link
                    href={`/admin/applications/${a.id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    {a.name ?? <Mono>—</Mono>}
                  </Link>
                </Td>
                <Td>
                  <Mono>{a.clientId}</Mono>
                </Td>
                <Td
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--ink-70)',
                    whiteSpace: 'pre-line',
                  }}
                >
                  {a.redirectUris.join('\n')}
                </Td>
                <Td>
                  <Mono>{a.scopes.join(' ') || '—'}</Mono>
                </Td>
                <Td>
                  {a.skipConsent ? (
                    <Badge variant="ink">First-party</Badge>
                  ) : (
                    <Badge variant="ghost">Third-party</Badge>
                  )}
                </Td>
                <Td>
                  <Mono>{fmtDate(a.createdAt)}</Mono>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table></div>
      )}

      <SectionRule>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--ink-55)',
              }}
            >
              / JWKS
            </span>
            <p
              style={{
                fontFamily: 'var(--serif)',
                fontStyle: 'italic',
                fontSize: 17,
                color: 'var(--ink-70)',
                margin: '8px 0 0',
                maxWidth: '64ch',
              }}
            >
              Signing keys for OIDC tokens. The active key rotates automatically every 90 days; old keys stay published until any token they signed has expired.
            </p>
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                gap: 28,
                alignItems: 'baseline',
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-55)',
                    display: 'block',
                  }}
                >
                  Active kid
                </span>
                <Mono style={{ fontSize: 12 }}>{jwksInfo?.id ?? '—'}</Mono>
              </div>
              <div>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-55)',
                    display: 'block',
                  }}
                >
                  Last rotated
                </span>
                <Mono style={{ fontSize: 12 }}>
                  {fmtDateTime(jwksInfo?.createdAt ?? null)}
                </Mono>
              </div>
            </div>
          </div>
          <RotateJwksDialog />
        </div>
      </SectionRule>
    </>
  )
}
