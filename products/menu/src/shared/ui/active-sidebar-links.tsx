'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  SidebarLink,
  SidebarLinks,
  SidebarSectionLabel,
  useSidebar,
} from '@iedora/design-system'

/**
 * Vertical sidebar navigation. One client island reads `usePathname()`
 * and renders the whole nav so we don't pay N readers — `<SidebarLink>`
 * then receives the active flag and the `<Link>` child for prefetch /
 * client-side routing.
 *
 * Items are either links or section labels. Mix freely:
 *
 *   const items = [
 *     { href: '/dashboard', label: 'Home', matchPrefix: false },
 *     { href: '/dashboard/billing', label: 'Billing' },
 *     { kind: 'section', label: 'Admin' },
 *     { href: '/dashboard/admin/qr-codes', label: 'QR Codes' },
 *     { href: '/dashboard/admin/sessions', label: 'Sessions' },
 *   ]
 *
 * Active matching for links:
 *   - `pathname === href` always wins.
 *   - For nested routes, `pathname.startsWith(href + '/')` also marks
 *     the parent active.
 *   - `matchPrefix: false` opts the link out of prefix matching.
 */

type LinkItem = {
  kind?: 'link'
  href: string
  label: string
  testId?: string
  /**
   * When false, only an exact `pathname === href` counts as active.
   * Defaults to true so nested routes light up the parent link.
   */
  matchPrefix?: boolean
}

type SectionItem = {
  kind: 'section'
  label: string
  testId?: string
}

export type ActiveSidebarItem = LinkItem | SectionItem

export function ActiveSidebarLinks({
  items,
  ariaLabel = 'Primary',
}: {
  items: ReadonlyArray<ActiveSidebarItem>
  ariaLabel?: string
}) {
  const pathname = usePathname() ?? '/'
  // On mobile, tapping a link navigates client-side but the drawer
  // would otherwise stay open over the new content. Close it on click;
  // at desktop the rail is always visible so the setter is a no-op.
  const { setOpen } = useSidebar()
  return (
    <SidebarLinks aria-label={ariaLabel}>
      {items.map((item, i) => {
        if (item.kind === 'section') {
          return (
            <SidebarSectionLabel
              key={`section-${i}`}
              data-test-id={item.testId}
            >
              {item.label}
            </SidebarSectionLabel>
          )
        }
        const active = isActive(pathname, item)
        return (
          <SidebarLink
            key={item.href}
            asChild
            active={active}
            data-test-id={item.testId}
            onClick={() => setOpen(false)}
          >
            <Link href={item.href}>{item.label}</Link>
          </SidebarLink>
        )
      })}
    </SidebarLinks>
  )
}

function isActive(pathname: string, item: LinkItem): boolean {
  if (pathname === item.href) return true
  if (item.matchPrefix === false) return false
  return pathname.startsWith(item.href + '/')
}
