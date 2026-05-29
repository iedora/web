import { getTranslations } from 'next-intl/server'
import {
  Card,
  EmptyState,
  Table,
  Badge,
  Field,
  FieldLabel,
  FieldInput,
  Button,
  Pagination,
} from '@iedora/design-system'
import { requireScope } from '@iedora/product-core'
import { SCOPES } from '@iedora/auth/scopes'
import {
  drizzleAuditGateway,
  listEvents,
} from '@iedora/product-core/features/audit'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'

const PAGE_SIZE = 50

type Search = Promise<{
  event?: string
  actorEmail?: string
  important?: string
  page?: string
}>

/**
 * Audit log timeline. Gated by `staff:core:audit:read` — iedora-admin
 * gets it via the wildcard binding; iedora-support does not. A future
 * "Auditor" role could carry just this scope.
 *
 * UI: filter bar (event prefix, actor email, important-only toggle) →
 * paginated table. Mobile-first: filter bar stacks vertical; table
 * scrolls horizontally inside its card; pagination is finger-sized.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Search
}) {
  await requireScope(SCOPES.core.staff.audit.read)
  const t = await getTranslations('Core.admin.audit')
  const params = await searchParams

  const event = params.event?.trim() || undefined
  const actorEmail = params.actorEmail?.trim() || undefined
  const importantOnly = params.important === 'true'
  const page = Math.max(1, Number(params.page) || 1)

  const gateway = drizzleAuditGateway()
  const result = await listEvents(gateway, {
    event,
    actorEmail,
    importantOnly,
    page,
    pageSize: PAGE_SIZE,
  })
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))

  return (
    <AdminPage
      crumbs={[{ label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' }]}
      title={t('title')}
      description={t('description')}
      data-test-id="admin-audit-page"
    >
      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          data-test-id="admin-audit-filter"
        >
          <Field className="flex-1 min-w-[200px]">
            <FieldLabel htmlFor="event">{t('filterEventLabel')}</FieldLabel>
            <FieldInput
              id="event"
              name="event"
              type="search"
              defaultValue={event ?? ''}
              placeholder={t('filterEventPlaceholder')}
              data-test-id="admin-audit-filter-event"
              inputMode="search"
              autoComplete="off"
            />
          </Field>
          <Field className="flex-1 min-w-[200px]">
            <FieldLabel htmlFor="actorEmail">
              {t('filterActorLabel')}
            </FieldLabel>
            <FieldInput
              id="actorEmail"
              name="actorEmail"
              type="search"
              defaultValue={actorEmail ?? ''}
              placeholder={t('filterActorPlaceholder')}
              data-test-id="admin-audit-filter-actor"
              inputMode="search"
              autoComplete="off"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:pb-2">
            <input
              type="checkbox"
              name="important"
              value="true"
              defaultChecked={importantOnly}
              data-test-id="admin-audit-filter-important"
              className="h-4 w-4 accent-[var(--cinnabar)]"
            />
            <span>{t('filterImportantOnly')}</span>
          </label>
          <Button
            type="submit"
            variant="primary"
            data-test-id="admin-audit-filter-submit"
          >
            {t('filterApply')}
          </Button>
        </form>
      </Card>

      {result.entries.length === 0 ? (
        <EmptyState label={t('empty')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table data-test-id="admin-audit-table">
              <thead>
                <tr>
                  <th>{t('columnAt')}</th>
                  <th>{t('columnEvent')}</th>
                  <th>{t('columnOutcome')}</th>
                  <th>{t('columnActor')}</th>
                  <th>{t('columnTarget')}</th>
                  <th>{t('columnDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {result.entries.map((e) => (
                  <tr
                    key={e.id}
                    data-test-id={`admin-audit-row-${e.id}`}
                  >
                    <td className="text-xs whitespace-nowrap">
                      {e.at.toLocaleString()}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-[family-name:var(--mono)] text-xs">
                          {e.event}
                        </span>
                        {e.important ? <Badge variant="accent">!</Badge> : null}
                      </div>
                    </td>
                    <td>
                      <Badge
                        variant={
                          e.outcome === 'success'
                            ? 'default'
                            : e.outcome === 'denied'
                              ? 'ink'
                              : 'accent'
                        }
                      >
                        {e.outcome}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      {e.actorEmail ? (
                        <div>
                          <div className="truncate max-w-[200px]">
                            {e.actorEmail}
                          </div>
                          {e.actorRole ? (
                            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-40)]">
                              {e.actorRole}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[var(--ink-40)]">
                          {t('actorSystem')}
                        </span>
                      )}
                    </td>
                    <td className="text-xs font-[family-name:var(--mono)]">
                      {e.targetUserId ?? e.targetTenantId ?? e.targetSessionId ?? '—'}
                    </td>
                    <td className="text-xs">
                      {e.meta ? (
                        <details>
                          <summary className="cursor-pointer text-[var(--ink-70)]">
                            {t('detailShow')}
                          </summary>
                          <pre className="mt-2 max-w-[420px] overflow-x-auto text-[10px]">
                            {JSON.stringify(e.meta, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {totalPages > 1 ? (
            <Pagination
              prevHref={pageHref(params, Math.max(1, page - 1))}
              nextHref={pageHref(params, Math.min(totalPages, page + 1))}
              prevLabel={t('paginationPrev')}
              nextLabel={t('paginationNext')}
              status={t('paginationOf', { page, totalPages })}
              isFirst={page <= 1}
              isLast={page >= totalPages}
              data-test-id="admin-audit-pagination"
            />
          ) : null}
        </Card>
      )}
    </AdminPage>
  )
}

function pageHref(params: Record<string, string | undefined>, page: number) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'page' && v) sp.set(k, v)
  }
  if (page > 1) sp.set('page', String(page))
  const q = sp.toString()
  return q ? `?${q}` : '?'
}
