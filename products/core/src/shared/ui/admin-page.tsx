import * as React from 'react'
import Link from 'next/link'
import {
  Breadcrumb,
  BreadcrumbHere,
  BreadcrumbLink,
} from '@iedora/design-system'

/**
 * Standard shell for every page on the admin surface — sibling of
 * `<DashboardPage>` over in menu, but tuned for the cross-tenant
 * admin context (different breadcrumb root, different test-id
 * namespace). Mobile-first: header collapses, content rhythm stays
 * consistent on phones.
 */

export type AdminCrumb = {
  label: React.ReactNode
  href: string
  testId?: string
}

export type AdminPageProps = {
  crumbs?: ReadonlyArray<AdminCrumb>
  title: React.ReactNode
  eyebrow?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  'data-test-id'?: string
}

export function AdminPage({
  crumbs = [],
  title,
  eyebrow,
  description,
  actions,
  children,
  'data-test-id': testId,
}: AdminPageProps) {
  const ns = (s: string) => (testId ? `${testId}-${s}` : undefined)
  const showHeaderRow = Boolean(eyebrow || description || actions)
  const hasTrail = crumbs.length > 0

  return (
    <div className="space-y-6" data-test-id={testId}>
      <div className="space-y-4 pr-14 lg:pr-0">
        {hasTrail ? (
          <Breadcrumb data-test-id={ns('breadcrumbs')}>
            {crumbs.map((c, i) => (
              <BreadcrumbLink
                key={c.href}
                asChild
                data-test-id={ns(`breadcrumb-${c.testId ?? i}`)}
              >
                <Link href={c.href}>{c.label}</Link>
              </BreadcrumbLink>
            ))}
            <BreadcrumbHere data-test-id={ns('breadcrumb-current')}>
              {title}
            </BreadcrumbHere>
          </Breadcrumb>
        ) : (
          <h1 className="ds-breadcrumb__here" data-test-id={ns('heading')}>
            {title}
          </h1>
        )}

        {showHeaderRow && (
          <header
            className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            data-test-id={ns('header')}
          >
            <div className="space-y-2 min-w-0">
              {eyebrow ? (
                <div className="eyebrow" data-test-id={ns('eyebrow')}>
                  {eyebrow}
                </div>
              ) : null}
              {description ? (
                <p
                  className="max-w-prose text-sm text-[var(--ink-70)]"
                  data-test-id={ns('description')}
                >
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? (
              <div
                className="flex flex-wrap items-center gap-3 sm:justify-end"
                data-test-id={ns('actions')}
              >
                {actions}
              </div>
            ) : null}
          </header>
        )}
      </div>

      <div className="space-y-10 sm:space-y-12">{children}</div>
    </div>
  )
}
