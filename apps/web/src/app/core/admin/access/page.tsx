import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Card, CardTitle, CardDesc, Badge } from '@iedora/design-system'
import { requireScope } from '@iedora/product-core'
import {
  SCOPES,
  ALL_SCOPES,
  parseScope,
  scopeI18nKey,
  type Scope,
} from '@iedora/core-auth/scopes'
import {
  STAFF_ROLES,
  STAFF_ROLE_PRESETS,
  detectStaffPreset,
  type StaffRoleKey,
} from '@iedora/core-auth/role-presets'
import { listUsers } from '@iedora/core-auth/server'
import { AdminPage } from '@iedora/product-core/shared/ui/admin-page'

/**
 * Access page — surfaces the role/scope taxonomy that gates the
 * cross-tenant staff surface. Two stacked sections:
 *
 *   1. Roles — one card per staff role with the scopes it grants as
 *      Badge chips. Derived from the AC binding via
 *      `listAllowedScopes()` — single source of truth, never
 *      duplicated.
 *   2. Scopes catalogue — every scope grouped by KIND → PRODUCT →
 *      RESOURCE → VERB, with a short description per verb. Mirrors
 *      the 4-segment scope format `<kind>:<product>:<resource>:<verb>`
 *      so the visual structure matches the string structure.
 *
 * Visible to ALL staff (not just iedora-admin) — knowing what your
 * role grants is itself a `users:read`-or-lower concern.
 *
 * Mobile-first: role cards stack 1→2 cols at lg+; chips wrap; the
 * catalogue uses a `<dl>` grid that collapses to a single column on
 * phones (no tables, no horizontal scroll).
 */
export default async function AccessPage() {
  const session = await requireScope(SCOPES.core.staff.admin.read)
  const t = await getTranslations('Core.admin.access')

  const roleKeys = STAFF_ROLES
  const roleScopes = roleKeys.map((key) => ({
    key,
    scopes: STAFF_ROLE_PRESETS[key],
  }))

  // Group scopes by KIND → PRODUCT → RESOURCE, in insertion order from
  // ALL_SCOPES (so the catalogue reads in the same order as the SCOPES
  // const declaration). The 4-segment string is what we display; the
  // parts are what we group on.
  type VerbEntry = { scope: Scope; verb: string }
  type ResourceMap = Map<string, VerbEntry[]>
  type ProductMap = Map<string, ResourceMap>
  type KindMap = Map<string, ProductMap>
  const grouped: KindMap = new Map()

  for (const scope of ALL_SCOPES) {
    const { kind, product, resource, verb } = parseScope(scope)
    if (!grouped.has(kind)) grouped.set(kind, new Map())
    const products = grouped.get(kind)!
    if (!products.has(product)) products.set(product, new Map())
    const resources = products.get(product)!
    if (!resources.has(resource)) resources.set(resource, [])
    resources.get(resource)!.push({ scope, verb })
  }

  const myScopes =
    ((session.user as { scopes?: string[] | null }).scopes ?? null) as
      | readonly Scope[]
      | null
  const myRole: StaffRoleKey | null = myScopes ? detectStaffPreset(myScopes) : null

  // Snapshot of every staff user. Roles are UX shortcuts that group
  // scopes; this listing makes the "who actually holds what" explicit
  // so the catalogue stops being abstract. Cap at 200 — staff sets
  // stay tiny; tenant users never appear here.
  const staffPage = await listUsers({ kind: 'staff', limit: 200 })
  type StaffUser = {
    id: string
    email: string
    name: string
    scopes: readonly Scope[]
  }
  const usersByPreset = new Map<StaffRoleKey, StaffUser[]>()
  const customStaff: StaffUser[] = []
  for (const u of staffPage.users) {
    const scopes = (u.scopes ?? []) as readonly Scope[]
    const preset = detectStaffPreset(scopes)
    const entry: StaffUser = {
      id: u.id,
      email: u.email,
      name: u.name,
      scopes,
    }
    if (preset) {
      const list = usersByPreset.get(preset) ?? []
      list.push(entry)
      usersByPreset.set(preset, list)
    } else {
      customStaff.push(entry)
    }
  }

  return (
    <AdminPage
      crumbs={[{ label: t('crumbAdmin'), href: '/core/admin', testId: 'admin' }]}
      title={t('title')}
      description={t('description')}
      data-test-id="admin-access-page"
    >
      <section
        className="space-y-3"
        data-test-id="admin-access-roles"
        aria-labelledby="admin-access-roles-heading"
      >
        <h2
          id="admin-access-roles-heading"
          className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]"
        >
          {t('rolesHeading')}
        </h2>
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
          {roleScopes.map(({ key, scopes }) => {
            const isMe = key === myRole
            return (
              <Card key={key} data-test-id={`admin-access-role-${key}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle as="h3">{key}</CardTitle>
                  {isMe ? (
                    <Badge
                      variant="accent"
                      data-test-id={`admin-access-role-${key}-mine`}
                    >
                      {t('youBadge')}
                    </Badge>
                  ) : null}
                </div>
                <CardDesc>{t(`roles.${key}.description`)}</CardDesc>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  data-test-id={`admin-access-role-${key}-scopes`}
                >
                  {scopes.length === 0 ? (
                    <span className="text-xs text-[var(--ink-40)]">
                      {t('noScopes')}
                    </span>
                  ) : (
                    scopes.map((s: Scope) => (
                      <Badge
                        key={s}
                        variant="ghost"
                        data-test-id={`admin-access-role-${key}-scope-${s}`}
                      >
                        {s}
                      </Badge>
                    ))
                  )}
                </div>
                <RoleMembers
                  roleKey={key}
                  members={usersByPreset.get(key) ?? []}
                  emptyLabel={t('membersEmpty')}
                  countLabel={(n: number) => t('membersCount', { count: n })}
                />
              </Card>
            )
          })}
        </div>

        {customStaff.length > 0 ? (
          <Card
            className="mt-4"
            data-test-id="admin-access-role-custom"
          >
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle as="h3">{t('customTitle')}</CardTitle>
              <Badge variant="ghost">{customStaff.length}</Badge>
            </div>
            <CardDesc>{t('customDescription')}</CardDesc>
            <RoleMembers
              roleKey="custom"
              members={customStaff}
              emptyLabel={t('membersEmpty')}
              countLabel={(n: number) => t('membersCount', { count: n })}
              showScopeCount
            />
          </Card>
        ) : null}
      </section>

      <section
        className="space-y-3"
        data-test-id="admin-access-scopes"
        aria-labelledby="admin-access-scopes-heading"
      >
        <h2
          id="admin-access-scopes-heading"
          className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]"
        >
          {t('scopesHeading')}
        </h2>
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([kind, products]) => (
            <Card
              key={kind}
              data-test-id={`admin-access-kind-${kind}`}
            >
              <div className="space-y-1">
                <CardTitle as="h3">{t(`kinds.${kind}`)}</CardTitle>
              </div>
              <div className="mt-4 space-y-6">
                {Array.from(products.entries()).map(([product, resources]) => (
                  <div
                    key={product}
                    className="space-y-3"
                    data-test-id={`admin-access-product-${kind}-${product}`}
                  >
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--ink-40)]">
                      {t(`products.${product}`)}
                    </div>
                    <dl className="divide-y divide-[var(--ink)]/10">
                      {Array.from(resources.entries()).map(
                        ([resource, verbs]) => (
                          <div
                            key={resource}
                            className="space-y-3 py-4 first:pt-0 last:pb-0"
                            data-test-id={`admin-access-resource-${kind}-${product}-${resource}`}
                          >
                            <div className="flex items-baseline gap-2">
                              <h4 className="font-medium">{resource}</h4>
                              <span className="text-xs text-[var(--ink-40)]">
                                {t('verbCount', { count: verbs.length })}
                              </span>
                            </div>
                            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
                              {verbs.map(({ scope, verb }) => (
                                <div
                                  key={scope}
                                  className="contents"
                                  data-test-id={`admin-access-scope-${scope}`}
                                >
                                  <dt>
                                    <Badge variant="ghost">{scope}</Badge>
                                  </dt>
                                  <dd className="text-sm text-[var(--ink-70)]">
                                    {t(
                                      scopeI18nKey(scope),
                                    )}
                                  </dd>
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </AdminPage>
  )
}

function RoleMembers({
  roleKey,
  members,
  emptyLabel,
  countLabel,
  showScopeCount,
}: {
  roleKey: string
  members: ReadonlyArray<{
    id: string
    email: string
    name: string
    scopes: readonly Scope[]
  }>
  emptyLabel: string
  countLabel: (n: number) => string
  showScopeCount?: boolean
}) {
  return (
    <div
      className="mt-5 border-t border-[var(--ink)]/10 pt-4"
      data-test-id={`admin-access-role-${roleKey}-members`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
          {countLabel(members.length)}
        </span>
      </div>
      {members.length === 0 ? (
        <p className="text-sm italic text-[var(--ink-55)]">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {members.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-baseline justify-between gap-2"
              data-test-id={`admin-access-role-${roleKey}-member-${u.id}`}
            >
              <Link
                href={`/core/admin/users/${u.id}`}
                className="text-sm font-medium text-[var(--ink)] no-underline hover:underline"
              >
                {u.name || u.email}
              </Link>
              <span className="font-[family-name:var(--mono)] text-[11px] text-[var(--ink-55)]">
                {u.email}
                {showScopeCount ? ` · ${u.scopes.length}` : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
