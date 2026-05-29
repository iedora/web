import { getTranslations } from 'next-intl/server'
import {
  Card,
  EmptyState,
  Table,
  Field,
  FieldLabel,
  FieldInput,
  Button,
} from '@iedora/design-system'
import { requireScope } from '@iedora/product-core'
import { SCOPES } from '@iedora/core-auth/scopes'
import {
  betterAuthAdminSessionsGateway,
  listAllSessions,
} from '@iedora/product-core/features/admin-sessions'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'
import { SessionRow } from '@iedora/product-core/features/admin-sessions/ui/session-row'

type Search = Promise<{ q?: string; impersonated?: string }>

export default async function SessionsAdminPage({
  searchParams,
}: {
  searchParams: Search
}) {
  await requireScope(SCOPES.core.staff.sessions.list)
  const t = await getTranslations('Core.admin.sessions')
  const params = await searchParams

  const q = params.q?.trim() || undefined
  const impersonatedOnly = params.impersonated === 'true'

  const gateway = betterAuthAdminSessionsGateway()
  const sessions = await listAllSessions(gateway, { q, impersonatedOnly })

  return (
    <AdminPage
      crumbs={[{ label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' }]}
      title={t('title')}
      description={t('subtitle')}
      data-test-id="admin-sessions-page"
    >
      <Card>
        <form
          // GET form — every input becomes a search param so the
          // URL is the single source of state.
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          data-test-id="admin-sessions-filter"
        >
          <Field className="flex-1">
            <FieldLabel htmlFor="q">{t('filterQueryLabel')}</FieldLabel>
            <FieldInput
              id="q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              placeholder={t('filterQueryPlaceholder')}
              data-test-id="admin-sessions-filter-q"
              inputMode="search"
              autoComplete="off"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:pb-2">
            <input
              type="checkbox"
              name="impersonated"
              value="true"
              defaultChecked={impersonatedOnly}
              data-test-id="admin-sessions-filter-impersonated"
              className="h-4 w-4 accent-[var(--cinnabar)]"
            />
            <span>{t('filterImpersonated')}</span>
          </label>
          <Button
            type="submit"
            variant="primary"
            data-test-id="admin-sessions-filter-submit"
          >
            {t('filterApply')}
          </Button>
        </form>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState label={t('empty')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table data-test-id="admin-sessions-table">
              <thead>
                <tr>
                  <th>{t('columnUser')}</th>
                  <th>{t('columnDevice')}</th>
                  <th>{t('columnIp')}</th>
                  <th>{t('columnIssued')}</th>
                  <th>{t('columnExpires')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    rowId={s.id}
                    token={s.token}
                    userId={s.userId}
                    userEmail={s.userEmail}
                    userName={s.userName}
                    ipAddress={s.ipAddress}
                    userAgent={s.userAgent}
                    createdAtIso={s.createdAt.toISOString()}
                    expiresAtIso={s.expiresAt.toISOString()}
                    impersonatedBy={s.impersonatedBy}
                  />
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </AdminPage>
  )
}
