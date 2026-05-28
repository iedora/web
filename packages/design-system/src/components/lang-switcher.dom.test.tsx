// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { LangSwitcher, type LangOption } from "./lang-switcher";

afterEach(() => cleanup());

const LANGS: LangOption[] = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "pt", name: "Português", flag: "🇵🇹" },
  { code: "es", name: "Español", flag: "🇪🇸" },
];

/** Walks the row scope so we don't collide with popover buttons. */
function row() {
  return document.querySelector(".ds-lang__row") as HTMLElement;
}

function Controlled({
  initial = "en",
  onChange,
}: {
  initial?: string;
  onChange?: (code: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <LangSwitcher
      langs={LANGS}
      value={value}
      onChange={(c) => {
        setValue(c);
        onChange?.(c);
      }}
      testIdPrefix="lang"
    />
  );
}

describe("LangSwitcher", () => {
  it("renders one inline button per language plus a compact trigger", () => {
    render(<Controlled />);
    const rowScope = within(row());
    expect(rowScope.getByRole("button", { name: "English" })).toBeDefined();
    expect(rowScope.getByRole("button", { name: "Português" })).toBeDefined();
    expect(rowScope.getByRole("button", { name: "Español" })).toBeDefined();
    // The compact trigger lives outside the row; CSS hides it above 520px
    // but jsdom doesn't honour that — we just check the element exists.
    const trigger = document.querySelector(".ds-lang__trigger");
    expect(trigger).not.toBeNull();
  });

  it("marks the active language with aria-pressed=true", () => {
    render(<Controlled initial="pt" />);
    const rowScope = within(row());
    expect(rowScope.getByRole("button", { name: "Português" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(rowScope.getByRole("button", { name: "English" }).getAttribute("aria-pressed"))
      .toBe("false");
  });

  it("calls onChange with the picked code when an inline button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const rowScope = within(row());
    await user.click(rowScope.getByRole("button", { name: "Português" }));
    expect(onChange).toHaveBeenCalledWith("pt");
  });

  it("opens the compact popover on trigger and lists the other languages", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="en" />);
    const trigger = document.querySelector(".ds-lang__trigger") as HTMLElement;
    await user.click(trigger);
    const items = screen.getAllByRole("menuitem");
    const names = items.map((el) => el.getAttribute("aria-label"));
    expect(names).toContain("Português");
    expect(names).toContain("Español");
    expect(names).not.toContain("English");
  });

  it("returns null when langs is empty so callers can guard at the boundary", () => {
    const onChange = vi.fn();
    const { container } = render(
      <LangSwitcher langs={[]} value="en" onChange={onChange} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
