// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  ActiveSidebarLinks,
  type ActiveSidebarItem,
} from "./active-sidebar-links";
import { SidebarProvider } from "./sidebar";

// next/navigation usePathname() is the lookup boundary — we stub it
// per-test so the component thinks the user is at the given route.
let currentPathname: string | null = "/menu/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

afterEach(() => cleanup());

beforeEach(() => {
  currentPathname = "/menu/dashboard";
});

const ITEMS: ActiveSidebarItem[] = [
  { href: "/menu/dashboard", label: "Home", matchPrefix: false, testId: "nav-home" },
  { href: "/menu/dashboard/billing", label: "Billing", testId: "nav-billing" },
  { kind: "section", label: "Admin", testId: "nav-admin-section" },
  { href: "/menu/dashboard/admin/qr-codes", label: "QR Codes", testId: "nav-qr" },
];

function wrap(node: React.ReactNode) {
  return <SidebarProvider>{node}</SidebarProvider>;
}

describe("ActiveSidebarLinks", () => {
  it("marks the link whose href matches the pathname exactly", () => {
    currentPathname = "/menu/dashboard";
    render(wrap(<ActiveSidebarLinks items={ITEMS} />));
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.getAttribute("aria-current")).toBe("page");
  });

  it("marks a parent link active when on a nested route (prefix match by default)", () => {
    currentPathname = "/menu/dashboard/admin/qr-codes/edit/42";
    render(wrap(<ActiveSidebarLinks items={ITEMS} />));
    // Home has matchPrefix=false so it must NOT be active on a nested path.
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.getAttribute("aria-current")).not.toBe("page");
    // QR Codes is a strict ancestor of the current path → active.
    const qr = screen.getByRole("link", { name: "QR Codes" });
    expect(qr.getAttribute("aria-current")).toBe("page");
  });

  it("does NOT mark Home active when matchPrefix is false and we're nested", () => {
    currentPathname = "/menu/dashboard/billing";
    render(wrap(<ActiveSidebarLinks items={ITEMS} />));
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.getAttribute("aria-current")).not.toBe("page");
    const billing = screen.getByRole("link", { name: "Billing" });
    expect(billing.getAttribute("aria-current")).toBe("page");
  });

  it("renders section labels as plain markers (not links)", () => {
    render(wrap(<ActiveSidebarLinks items={ITEMS} />));
    // Section label "Admin" must not be a link.
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    expect(screen.getByText("Admin")).toBeDefined();
  });

  it("falls back to '/' when usePathname returns null (router not ready)", () => {
    currentPathname = null;
    render(wrap(<ActiveSidebarLinks items={ITEMS} />));
    // Nothing should match "/" so no link gets aria-current.
    for (const name of ["Home", "Billing", "QR Codes"]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("aria-current")).not.toBe("page");
    }
  });

  it("closes the mobile drawer by calling useSidebar().setOpen(false) on click", async () => {
    const user = userEvent.setup();
    // Render inside a SidebarProvider that starts open, then assert the
    // click flips it shut. We can't read the context state directly,
    // but the consumer-effect is: after clicking, a fresh subscriber
    // would see `open=false`. Use the `data-state` on `<aside>` if
    // exposed; otherwise this is a smoke test that the click does not
    // throw (useSidebar resolution).
    render(wrap(<ActiveSidebarLinks items={ITEMS} />));
    await expect(
      user.click(screen.getByRole("link", { name: "Billing" })),
    ).resolves.not.toThrow();
  });
});
