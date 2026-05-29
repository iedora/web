import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import {
  Card,
  EmptyState,
  Table,
  Badge,
  Pagination,
} from '@iedora/design-system'
import { hasScope, requireScope } from '@iedora/product-core'
import { SCOPES } from '@iedora/core-auth/scopes'
import {
  betterAuthAdminUsersGateway,
  listUsers,
} from '@iedora/product-core/features/admin-users'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'
import { UsersFilterBar } from '@iedora/product-core/features/admin-users/ui/users-filter-bar'
import { UserRowActions } from '@iedora/product-core/features/admin-users/ui/user-row-actions'
import { PRODUCTS, productUrl } from '@iedora/brand'

const PAGE_SIZE = 50

type Params = Promise<Record<string, never>>
type Search = Promise<{
  q?: string
  role?: string
  banned?: string
  page?: string
  sort?: string
  dir?: string
}>

export default async function UsersAdminPage({
  searchParams,
}: {
  params: Params
  searchParams: Search
}) {
  const session = await requireScope(SCOPES.core.staff.users.read)
  const [canImpersonate, canBan] = await Promise.all([
    hasScope(SCOPES.core.staff.users.impersonate),
    hasScope(SCOPES.core.staff.users.ban),
  ])
  const t = await getTranslations('Core.admin.users')
  const params = await searchParams

  const q = params.q?.trim() || undefined
  const role =
    params.role === 'iedora-admin'
      ? 'iedora-admin'
      : params.role === 'member'
        ? null
        : undefined
  const banned =
    params.banned === 'true' ? true : params.banned === 'false' ? false : undefined
  const page = Math.max(1, Number(params.page) || 1)
  const sortBy =
    params.sort === 'name' || params.sort === 'email' ? params.sort : 'createdAt'
  const sortDirection = params.dir === 'asc' ? 'asc' : 'desc'

  const gateway = betterAuthAdminUsersGateway()
  const result = await listUsers(gateway, {
    q,
    role,
    banned,
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
      data-test-id="admin-users-page"
    >
      <Card>
        <UsersFilterBar
          defaults={{
            q: params.q,
            role:
              params.role === 'iedora-admin' || params.role === 'member'
                ? params.role
                : null,
            banned:
              params.banned === 'true' || params.banned === 'false'
                ? params.banned
                : null,
          }}
        />
      </Card>

      {result.users.length === 0 ? (
        <EmptyState label={t('empty')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table data-test-id="admin-users-table">
              <thead>
                <tr>
                  <th>{t('columnUser')}</th>
                  <th>{t('columnRole')}</th>
                  <th>{t('columnStatus')}</th>
                  <th>{t('columnCreated')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.users.map((u) => (
                  <tr
                    key={u.id}
                    data-test-id={`admin-users-row-${u.id}`}
                  >
                    <td>
                      <Link
                        href={`/core/admin/users/${u.id}`}
                        className="block hover:underline"
                        data-test-id={`admin-users-row-link-${u.id}`}
                      >
                        <div className="font-medium">{u.name || '—'}</div>
                        <div className="text-xs text-[var(--ink-70)]">
                          {u.email}
                        </div>
                      </Link>
                    </td>
                    <td>
                      {u.role === 'iedora-admin' ? (
                        <Badge>{t('roleIedoraAdmin')}</Badge>
                      ) : (
                        <span className="text-xs text-[var(--ink-70)]">
                          {t('roleMember')}
                        </span>
                      )}
                    </td>
                    <td>
                      {u.banned ? (
                        <Badge data-test-id={`admin-users-banned-badge-${u.id}`}>
                          {t('statusBanned')}
                        </Badge>
                      ) : u.emailVerified ? (
                        <span className="text-xs text-[var(--ink-70)]">
                          {t('statusActive')}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--ink-70)]">
                          {t('statusUnverified')}
                        </span>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {u.createdAt.toLocaleDateString()}
                    </td>
                    <td>
                      <UserRowActions
                        userId={u.id}
                        userEmail={u.email}
                        isBanned={u.banned}
                        isSelf={u.id === session.user.id}
                        postImpersonateUrl={productUrl(PRODUCTS.menu)}
                        canImpersonate={canImpersonate}
                        canBan={canBan}
                      />
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
              data-test-id="admin-users-pagination"
            />
          ) : null}
        </Card>
      )}
    </AdminPage>
  )
}

function pageHref(
  params: Record<string, string | undefined>,
  page: number,
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'page' && v) sp.set(k, v)
  }
  if (page > 1) sp.set('page', String(page))
  const q = sp.toString()
  return q ? `?${q}` : '?'
}
