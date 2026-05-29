import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import {
  Card,
  CardTitle,
  CardDesc,
  EmptyState,
  Table,
  Badge,
  Button,
} from '@iedora/design-system'
import { hasScope, requireScope } from '@iedora/product-core'
import { SCOPES } from '@iedora/core-auth/scopes'
import {
  betterAuthAdminUsersGateway,
  listUserSessions,
  getUserById,
} from '@iedora/product-core/features/admin-users'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'
import {
  ScopeList,
  PresetHeader,
} from '@iedora/product-core/shared/ui/scope-matrix'
import { RoleSelect } from '@iedora/product-core/features/admin-users/ui/role-select'
import { UserRowActions } from '@iedora/product-core/features/admin-users/ui/user-row-actions'
import { SessionRow } from '@iedora/product-core/features/admin-sessions/ui/session-row'
import { revokeAllUserSessionsAction as revokeAllAction } from '@iedora/product-core/features/admin-users/actions'

async function revokeAllUserSessionsForm(userId: string) {
  'use server'
  await revokeAllAction({ userId })
}
import { PRODUCTS, productUrl } from '@iedora/brand'

type Params = Promise<{ userId: string }>

export default async function UserAdminDetailPage({
  params,
}: {
  params: Params
}) {
  const session = await requireScope(SCOPES.core.staff.users.read)
  const [canImpersonate, canBan, canSetRole] = await Promise.all([
    hasScope(SCOPES.core.staff.users.impersonate),
    hasScope(SCOPES.core.staff.users.ban),
    hasScope(SCOPES.core.staff.users.setRole),
  ])
  const t = await getTranslations('Core.admin.users.detail')
  const { userId } = await params

  const gateway = betterAuthAdminUsersGateway()
  const user = await getUserById(gateway, { userId })
  if (!user) notFound()

  const sessions = await listUserSessions(gateway, { userId })
  const isSelf = userId === session.user.id

  return (
    <AdminPage
      crumbs={[
        { label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' },
        { label: t('crumbUsers'), href: '/core/admin/users', testId: 'users' },
      ]}
      title={user.name || user.email}
      eyebrow={user.email}
      description={isSelf ? t('descriptionSelf') : undefined}
      actions={
        <UserRowActions
          userId={userId}
          userEmail={user.email}
          isBanned={user.banned}
          isSelf={isSelf}
          postImpersonateUrl={productUrl(PRODUCTS.menu)}
          canImpersonate={canImpersonate}
          canBan={canBan}
        />
      }
      data-test-id="admin-user-detail"
    >
      <section
        className="grid gap-5 sm:grid-cols-2 sm:gap-6"
        data-test-id="admin-user-detail-cards"
      >
        <Card>
          <CardTitle as="h2">{t('roleTitle')}</CardTitle>
          <CardDesc>{t('roleDesc')}</CardDesc>
          <div className="mt-4">
            <RoleSelect
              userId={userId}
              currentRole={user.role}
              disabled={isSelf}
              canSetRole={canSetRole}
            />
          </div>
        </Card>
        <Card>
          <CardTitle as="h2">{t('statusTitle')}</CardTitle>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {user.banned ? (
              <Badge data-test-id="admin-user-detail-banned-badge">
                {t('statusBanned')}
              </Badge>
            ) : (
              <span className="text-sm">{t('statusActive')}</span>
            )}
            {user.emailVerified ? (
              <Badge>{t('statusVerified')}</Badge>
            ) : (
              <span className="text-sm text-[var(--ink-70)]">
                {t('statusUnverified')}
              </span>
            )}
          </div>
          {user.banned && user.banReason ? (
            <p className="mt-3 text-sm text-[var(--ink-70)]">
              {t('banReasonLabel')}: {user.banReason}
            </p>
          ) : null}
        </Card>
      </section>

      <section data-test-id="admin-user-scopes">
        <Card>
          <CardTitle as="h2">{t('scopesTitle')}</CardTitle>
          <CardDesc>{t('scopesDesc')}</CardDesc>
          <div className="mt-4">
            <PresetHeader
              name={user.role ?? t('scopesPresetCustom')}
              scopeCount={user.scopes?.length ?? 0}
              sourceLabel={
                user.scopes === null
                  ? t('scopesSourceTenant')
                  : user.role
                    ? t('scopesSourceBuiltIn')
                    : t('scopesSourceCustom')
              }
              highlight={user.role === 'iedora-admin'}
            />
          </div>
          <div className="mt-4">
            <ScopeList
              scopes={user.scopes ?? []}
              emptyLabel={t('scopesEmpty')}
              data-test-id="admin-user-scopes-list"
            />
          </div>
        </Card>
      </section>

      <section>
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="ds-section-header__title">{t('sessionsTitle')}</h2>
          {sessions.length > 0 ? (
            <span className="text-xs text-[var(--ink-70)]">
              {t('sessionsCount', { count: sessions.length })}
            </span>
          ) : null}
        </header>
        {sessions.length === 0 ? (
          <EmptyState label={t('sessionsEmpty')} />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table data-test-id="admin-user-sessions-table">
                <thead>
                  <tr>
                    <th>{t('sessionColumnDevice')}</th>
                    <th>{t('sessionColumnIp')}</th>
                    <th>{t('sessionColumnIssued')}</th>
                    <th>{t('sessionColumnExpires')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      rowId={s.id}
                      token={s.token}
                      userId={userId}
                      userEmail={user.email}
                      userName={user.name}
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
            {!isSelf && (
              <form
                action={revokeAllUserSessionsForm.bind(null, userId)}
                className="mt-4 flex justify-end"
              >
                <Button
                  type="submit"
                  variant="ghost"
                  data-test-id="admin-user-revoke-all-sessions"
                >
                  {t('revokeAll')}
                </Button>
              </form>
            )}
          </Card>
        )}
      </section>
    </AdminPage>
  )
}
