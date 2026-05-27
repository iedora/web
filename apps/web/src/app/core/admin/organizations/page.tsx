import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import {
  Card,
  EmptyState,
  Table,
  Button,
  Badge,
  Pagination,
} from '@iedora/design-system'
import { requireIedoraAdmin } from '@iedora/product-core'
import {
  drizzleAdminOrgsGateway,
  listOrgs,
} from '@iedora/product-core/features/admin-orgs'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'
import { OrgsFilterBar } from '@iedora/product-core/features/admin-orgs/ui/orgs-filter-bar'

const PAGE_SIZE = 50

type Search = Promise<{
  q?: string
  page?: string
  sort?: string
  dir?: string
}>

export default async function OrganizationsAdminPage({
  searchParams,
}: {
  searchParams: Search
}) {
  await requireIedoraAdmin()
  const t = await getTranslations('Core.admin.orgs')
  const params = await searchParams

  const q = params.q?.trim() || undefined
  const page = Math.max(1, Number(params.page) || 1)
  const sortBy = params.sort === 'name' ? 'name' : 'createdAt'
  const sortDirection = params.dir === 'asc' ? 'asc' : 'desc'

  const gateway = drizzleAdminOrgsGateway()
  const result = await listOrgs(gateway, {
    q,
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDirection,
  })
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))

  return (
    <AdminPage
      crumbs={[{ label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' }]}
      title={t('title')}
      description={t('description')}
      data-test-id="admin-orgs-page"
    >
      <Card>
        <OrgsFilterBar defaults={{ q: params.q }} />
      </Card>

      {result.orgs.length === 0 ? (
        <EmptyState label={t('empty')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table data-test-id="admin-orgs-table">
              <thead>
                <tr>
                  <th>{t('columnOrg')}</th>
                  <th>{t('columnMembers')}</th>
                  <th>{t('columnPlan')}</th>
                  <th>{t('columnCreated')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.orgs.map((o) => {
                  const plan =
                    typeof o.metadata?.plan === 'string'
                      ? (o.metadata.plan as string)
                      : null
                  return (
                    <tr
                      key={o.id}
                      data-test-id={`admin-orgs-row-${o.id}`}
                    >
                      <td>
                        <Link
                          href={`/core/admin/organizations/${o.id}`}
                          className="block hover:underline"
                          data-test-id={`admin-orgs-row-link-${o.id}`}
                        >
                          <div className="font-medium">{o.name}</div>
                          {o.slug ? (
                            <div className="text-xs text-[var(--ink-70)]">
                              {o.slug}
                            </div>
                          ) : null}
                        </Link>
                      </td>
                      <td className="text-xs">{o.memberCount}</td>
                      <td>
                        {plan ? (
                          <Badge>{plan}</Badge>
                        ) : (
                          <span className="text-xs text-[var(--ink-40)]">
                            —
                          </span>
                        )}
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {o.createdAt.toLocaleDateString()}
                      </td>
                      <td className="text-right">
                        <Button
                          as="a"
                          href={`/core/admin/organizations/${o.id}`}
                          variant="ghost"
                          data-test-id={`admin-orgs-row-view-${o.id}`}
                        >
                          {t('view')}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
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
              data-test-id="admin-orgs-pagination"
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
