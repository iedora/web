// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Combobox, type ComboboxOption } from "./combobox";

afterEach(() => {
  cleanup();
  // Radix portal can leak pointer-events:none across tests (see dialog.dom.test).
  document.body.style.pointerEvents = "";
});

const u = () => userEvent.setup({ pointerEventsCheck: 0 });

const SAMPLE: ComboboxOption[] = [
  { value: "alpha", label: "Alpha", hint: "α" },
  { value: "beta", label: "Beta", hint: "β" },
  { value: "betacarotene", label: "Beta Carotene" },
  { value: "gamma", label: "Gamma" },
];

function ControlledCombobox(props: { onChange?: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      aria-label="pick one"
      options={SAMPLE}
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      placeholder="— pick —"
    />
  );
}

describe("Combobox", () => {
  it("renders an input with the placeholder when nothing is selected", () => {
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).value).toBe("");
    expect(input.getAttribute("placeholder")).toMatch(/pick/i);
  });

  it("opens the listbox on focus and shows every option", async () => {
    const user = u();
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(SAMPLE.length);
  });

  it("filters as the user types — same input, no separate search field", async () => {
    const user = u();
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.type(input, "beta");
    expect(screen.getAllByRole("option")).toHaveLength(2); // Beta + Beta Carotene
    expect(screen.queryByRole("option", { name: /alpha/i })).toBeNull();
    // The input's value reflects the query while the dropdown is open.
    expect((input as HTMLInputElement).value).toBe("beta");
  });

  it("matches via the hint field too (β resolves to Beta)", async () => {
    const user = u();
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.type(input, "β");
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]?.textContent).toContain("Beta");
    expect(opts[0]?.textContent).toContain("β");
  });

  it("shows the empty message when nothing matches", async () => {
    const user = u();
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.type(input, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/no matches/i)).toBeDefined();
  });

  it("selects via Enter on the active item and restores the label as the input value", async () => {
    const user = u();
    const onChange = vi.fn();
    render(<ControlledCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("betacarotene");
    // After commit, dropdown closes and the input shows the selected label.
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect((input as HTMLInputElement).value).toBe("Beta Carotene");
  });

  it("selects on click", async () => {
    const user = u();
    const onChange = vi.fn();
    render(<ControlledCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /gamma/i }));
    expect(onChange).toHaveBeenCalledWith("gamma");
    expect((input as HTMLInputElement).value).toBe("Gamma");
  });

  it("closes on Escape without changing the value", async () => {
    const user = u();
    const onChange = vi.fn();
    render(<ControlledCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes an inline × clear button when something is selected; clearing emits null", async () => {
    const user = u();
    const onChange = vi.fn();
    render(<ControlledCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    // Before selection — no clear button.
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    // Pick one.
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /alpha/i }));
    // The clear button appears in the input chrome.
    const clear = screen.getByRole("button", { name: /clear/i });
    await user.click(clear);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("Backspace on empty query clears the current selection", async () => {
    const user = u();
    const onChange = vi.fn();
    render(<ControlledCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /alpha/i }));
    // Re-focus and press Backspace with no query typed.
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("sets title on label + hint spans so truncated text is still readable on hover", async () => {
    const longOptions: ComboboxOption[] = [
      {
        value: "long",
        label: "A Cantinho da Avó Maria — Tasca de Bairro",
        hint: "a-cantinho-da-avo-maria-tasca",
      },
    ];
    function LongLabelCombobox() {
      const [v, setV] = useState<string | null>(null);
      return (
        <Combobox
          aria-label="pick"
          options={longOptions}
          value={v}
          onChange={setV}
        />
      );
    }
    const user = u();
    render(<LongLabelCombobox />);
    await user.click(screen.getByRole("combobox", { name: /pick/i }));
    const labelSpan = screen.getByText(/Cantinho da Avó Maria/);
    const hintSpan = screen.getByText(/a-cantinho-da-avo-maria-tasca/);
    expect(labelSpan.getAttribute("title")).toBe(
      "A Cantinho da Avó Maria — Tasca de Bairro",
    );
    expect(hintSpan.getAttribute("title")).toBe(
      "a-cantinho-da-avo-maria-tasca",
    );
  });

  it("sets title on the input to the current selection's label (for hover-to-read when truncated)", async () => {
    const user = u();
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    // No selection yet → no title.
    expect(input.getAttribute("title")).toBeNull();
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /beta carotene/i }));
    // After commit + close, the title carries the full label.
    expect(input.getAttribute("title")).toBe("Beta Carotene");
  });

  it("input class carries the specificity-bumped selector so a Combobox inside a Field doesn't pick up the Field's 18px base rule", () => {
    // The Field's base rule `.ds-field input` (specificity 0,1,1) wins
    // against `.ds-combobox__input` (0,1,0) unless we add a same-
    // specificity selector. We can't observe layout in jsdom but we can
    // assert the className contract the consumer relies on so a future
    // rename breaks this test loudly.
    render(<ControlledCombobox />);
    const input = screen.getByRole("combobox", { name: /pick one/i });
    expect(input.className).toContain("ds-combobox__input");
  });

  it("renders a hidden form-input when `name` is provided", () => {
    function FormCombobox() {
      const [v, setV] = useState<string | null>("beta");
      return (
        <Combobox
          options={SAMPLE}
          value={v}
          onChange={setV}
          name="favorite"
        />
      );
    }
    const { container } = render(<FormCombobox />);
    const hidden = container.querySelector(
      'input[type="hidden"][name="favorite"]',
    ) as HTMLInputElement | null;
    expect(hidden?.value).toBe("beta");
  });
});
