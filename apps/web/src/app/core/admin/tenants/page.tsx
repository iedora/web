import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  Button,
  EmptyState,
  Field,
  FieldInput,
  FieldLabel,
  Pagination,
  Table,
  Td,
  Th,
} from '@iedora/design-system'
import { requireScope } from '@iedora/product-core'
import {
  drizzleAdminTenantsGateway,
  listTenants,
} from '@iedora/product-core/features/admin-tenants'
import { SCOPES } from '@iedora/core-auth/scopes'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'

/**
 * Cross-tenant tenant list — staff drilling into the customer base.
 * Read-only today (mutations land in a follow-up with the
 * `staff.core.tenants.delete` + `staff.core.members.*` actions).
 *
 * Mobile-first layout:
 *   - On phones: filter chip + button stack vertically; the list
 *     renders as a stack of cards (one per tenant) — no horizontal
 *     scroll, no clipped columns.
 *   - On sm+ : filter row goes inline; the list switches to the
 *     editorial DS `<Table>` with right-aligned numeric columns.
 *
 * Pagination uses the DS `<Pagination>` component (link-driven so
 * server pages don't need a router hook).
 */

type SearchParams = {
  page?: string
  q?: string
  sort?: 'createdAt' | 'name'
  dir?: 'asc' | 'desc'
}

const PAGE_SIZE = 25

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireScope(SCOPES.core.staff.tenants.list)
  const t = await getTranslations('Core.admin.tenants')

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const sort: 'createdAt' | 'name' = sp.sort === 'name' ? 'name' : 'createdAt'
  const dir: 'asc' | 'desc' = sp.dir === 'asc' ? 'asc' : 'desc'
  const activeQuery = sp.q?.trim() || ''

  const { tenants, total } = await listTenants(drizzleAdminTenantsGateway(), {
    page,
    pageSize: PAGE_SIZE,
    q: activeQuery || undefined,
    sortBy: sort,
    sortDirection: dir,
  })

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <AdminPage
      crumbs={[{ label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' }]}
      title={t('title')}
      description={t('description', { count: total })}
      data-test-id="admin-tenants-page"
    >
      <form
        method="get"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        data-test-id="admin-tenants-filter"
      >
        <Field className="flex-1">
          <FieldLabel htmlFor="admin-tenants-q">{t('searchLabel')}</FieldLabel>
          <FieldInput
            id="admin-tenants-q"
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder={t('searchPlaceholder')}
            data-test-id="admin-tenants-search-input"
          />
        </Field>
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="solid"
            className="flex-1 sm:flex-initial"
            data-test-id="admin-tenants-search-submit"
          >
            {t('searchSubmit')}
          </Button>
          {activeQuery ? (
            <Button
              as="a"
              href="/core/admin/tenants"
              variant="ghost"
              data-test-id="admin-tenants-search-clear"
            >
              {t('searchClear')}
            </Button>
          ) : null}
        </div>
      </form>

      <section
        className="mt-2"
        aria-label={t('listAriaLabel')}
        data-test-id="admin-tenants-list-section"
      >
        {tenants.length === 0 ? (
          <EmptyState
            label={t('emptyLabel')}
            note={
              activeQuery
                ? t('emptyFilteredNote', { q: activeQuery })
                : t('emptyNote')
            }
            data-test-id="admin-tenants-empty"
          />
        ) : (
          <>
            {/* Mobile: stacked cards. One tenant per row, tap-target
                the whole card. Hidden on sm+. */}
            <ul
              className="space-y-3 sm:hidden"
              data-test-id="admin-tenants-list-mobile"
            >
              {tenants.map((tn) => (
                <li key={tn.id}>
                  <Link
                    href={`/core/admin/tenants/${tn.id}`}
                    className="block border border-[var(--ink-14)] bg-[var(--paper)] px-4 py-3 no-underline transition-colors hover:border-[var(--ink-40)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cinnabar)]"
                    data-test-id={`admin-tenants-row-${tn.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 font-medium text-[var(--ink)]">
                        {tn.name}
                      </span>
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-55)] tabular-nums">
                        {t('memberCountShort', { count: tn.memberCount })}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-[family-name:var(--mono)] text-[11px] text-[var(--ink-40)]">
                      {tn.id}
                    </div>
                    <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-55)] tabular-nums">
                      {t('createdAtLabel')} {dateFmt.format(tn.createdAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Tablet+: full table. */}
            <div
              className="hidden sm:block"
              data-test-id="admin-tenants-list-table"
            >
              <Table>
                <thead>
                  <tr>
                    <Th>{t('colName')}</Th>
                    <Th className="text-right">{t('colMembers')}</Th>
                    <Th className="text-right">{t('colCreated')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tn) => (
                    <tr
                      key={tn.id}
                      data-test-id={`admin-tenants-row-${tn.id}`}
                    >
                      <Td>
                        <Link
                          href={`/core/admin/tenants/${tn.id}`}
                          className="font-medium text-[var(--ink)] no-underline hover:underline"
                          data-test-id={`admin-tenants-row-${tn.id}-link`}
                        >
                          {tn.name}
                        </Link>
                        <div className="font-[family-name:var(--mono)] text-[11px] text-[var(--ink-40)]">
                          {tn.id}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums">
                        {tn.memberCount}
                      </Td>
                      <Td className="text-right text-[var(--ink-70)] tabular-nums">
                        {dateFmt.format(tn.createdAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </section>

      {totalPages > 1 ? (
        <Pagination
          prevHref={pageHref(sp, page - 1)}
          nextHref={pageHref(sp, page + 1)}
          prevLabel={t('paginationPrev')}
          nextLabel={t('paginationNext')}
          status={t('paginationPosition', { page, total: totalPages })}
          isFirst={page <= 1}
          isLast={page >= totalPages}
          aria-label={t('paginationLabel')}
          data-test-id="admin-tenants-pagination"
        />
      ) : null}
    </AdminPage>
  )
}

function pageHref(sp: SearchParams, target: number): string {
  const qs = new URLSearchParams()
  if (sp.q) qs.set('q', sp.q)
  if (sp.sort) qs.set('sort', sp.sort)
  if (sp.dir) qs.set('dir', sp.dir)
  if (target > 1) qs.set('page', String(target))
  const s = qs.toString()
  return s ? `/core/admin/tenants?${s}` : '/core/admin/tenants'
}
