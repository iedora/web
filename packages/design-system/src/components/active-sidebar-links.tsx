"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarLink,
  SidebarLinks,
  SidebarSectionLabel,
  useSidebar,
} from "./sidebar";

/**
 * Tiny client island that resolves the active sidebar item against
 * `usePathname()` and renders the cinnabar rail on it. Keeps the server
 * layout free of the `usePathname` boundary while `<Link>` children
 * stay prefetchable.
 *
 *   const items: ActiveSidebarItem[] = [
 *     { href: "/menu/dashboard", label: t("home"), matchPrefix: false },
 *     { href: "/menu/dashboard/billing", label: t("billing") },
 *     { kind: "section", label: t("admin") },
 *     { href: "/menu/dashboard/admin/qr-codes", label: t("qrCodes") },
 *   ];
 *
 * Active matching for links:
 *   - `pathname === href` always wins.
 *   - For nested routes, `pathname.startsWith(href + '/')` also marks
 *     the parent active.
 *   - `matchPrefix: false` opts the link out of prefix matching.
 *
 * On mobile the sidebar is a drawer that needs explicit dismissal
 * after a navigation — we call `useSidebar().setOpen(false)` on click
 * so the user lands on the new view instead of the still-open menu.
 *
 * Next-bound by design: every iedora surface is a Next app, and the
 * `usePathname` + `<Link>` pair is the right shape for the routing /
 * prefetch story we want. If a non-Next consumer ever appears, expose
 * a framework-agnostic variant alongside this one rather than swapping
 * the import shape.
 */

type LinkItem = {
  kind?: "link";
  href: string;
  label: React.ReactNode;
  testId?: string;
  /**
   * When false, only an exact `pathname === href` counts as active.
   * Defaults to true so nested routes light up their parent link.
   */
  matchPrefix?: boolean;
};

type SectionItem = {
  kind: "section";
  label: React.ReactNode;
  testId?: string;
};

export type ActiveSidebarItem = LinkItem | SectionItem;

export type ActiveSidebarLinksProps = {
  items: ReadonlyArray<ActiveSidebarItem>;
  /** Defaults to `"Primary"` — override per-surface for clearer a11y. */
  ariaLabel?: string;
};

export function ActiveSidebarLinks({
  items,
  ariaLabel = "Primary",
}: ActiveSidebarLinksProps) {
  const pathname = usePathname() ?? "/";
  const { setOpen } = useSidebar();

  return (
    <SidebarLinks aria-label={ariaLabel}>
      {items.map((item, i) => {
        if (item.kind === "section") {
          return (
            <SidebarSectionLabel
              key={`section-${i}`}
              data-test-id={item.testId}
            >
              {item.label}
            </SidebarSectionLabel>
          );
        }
        const active = isActive(pathname, item);
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
        );
      })}
    </SidebarLinks>
  );
}

function isActive(pathname: string, item: LinkItem): boolean {
  if (pathname === item.href) return true;
  if (item.matchPrefix === false) return false;
  return pathname.startsWith(item.href + "/");
}
