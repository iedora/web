import * as React from "react";
import { Popover } from "radix-ui";
import { cn } from "../lib/cn";

/**
 * Iedora Manual § VI.4 — Combobox.
 *
 * A searchable dropdown for "pick one from a list" inputs. Built on top
 * of Radix's `Popover` (which gives us portal + outside-click + focus
 * trap + collision-aware positioning) with a hand-rolled state machine
 * for the search-filter + keyboard navigation. The same shape Ariakit
 * and Headless UI converge on:
 *
 *   <Combobox value={...} onChange={...} options={[{value, label, hint?}]} />
 *
 * Why not the native `<select>`: it doesn't support typeahead search
 * across long lists, and the cross-browser styling makes editorial
 * presentation impossible (Safari + Firefox each render `appearance:
 * none` selects with their own padding rules — see the broken
 * "— unbound —" overlap in the qr-codes admin before this primitive
 * existed).
 *
 * Accessibility:
 *   - Trigger button announces label via `aria-haspopup="listbox"`.
 *   - Search input owns the listbox; arrow keys / Enter / Esc work as a
 *     11y expects.
 *   - Hidden `<input type="hidden" name={name} value={value}>` so the
 *     component participates in plain form submission without wiring
 *     onChange callbacks at the form level.
 *
 * Mobile:
 *   - The popover width matches the trigger (`--radix-popover-trigger-width`
 *     CSS var) and the max-height clamps to viewport, so on narrow
 *     screens the list scrolls inside its own pane instead of pushing
 *     surrounding content.
 */

export type ComboboxOption = {
  value: string;
  label: string;
  /** Secondary text rendered to the right of the label (e.g. slug, id). */
  hint?: string;
};

export type ComboboxProps = {
  options: ReadonlyArray<ComboboxOption>;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Trigger placeholder when nothing is selected. */
  placeholder?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Empty-result message. */
  emptyMessage?: string;
  /** Show a Clear button in the popover header when something is selected. */
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  /** When set, a hidden input is rendered so the combobox can be part of
   * a plain `<form>` submission. */
  name?: string;
  className?: string;
  /** Additional className for the popover content (rarely needed). */
  popoverClassName?: string;
};

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "— select —",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  clearable = true,
  disabled = false,
  id,
  name,
  className,
  popoverClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ? o.hint.toLowerCase().includes(q) : false),
    );
  }, [options, query]);

  // Reset active index when the filtered set changes shape.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length, query]);

  // When opening, focus the search input on next paint. Radix's Popover
  // moves focus to the content root by default; we want it on the input
  // so typing-to-search works without an extra click.
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Keep the active item in view as the user arrows through a long list.
  React.useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelectorAll<HTMLLIElement>("[role='option']")[activeIndex];
    if (node) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  const current = options.find((o) => o.value === value) ?? null;
  const triggerLabel = current ? current.label : placeholder;
  const triggerIsPlaceholder = current === null;

  function commit(opt: ComboboxOption | null) {
    onChange(opt ? opt.value : null);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn("ds-combobox__trigger", className)}
          data-placeholder={triggerIsPlaceholder ? "" : undefined}
        >
          <span className="ds-combobox__value">{triggerLabel}</span>
          <span aria-hidden className="ds-combobox__chevron">
            <ChevronDownIcon />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn("ds-combobox__popover", popoverClassName)}
          onOpenAutoFocus={(e) => {
            // Defer focus to the search input — see effect above.
            e.preventDefault();
          }}
        >
          <div className="ds-combobox__searchbar">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-controls="ds-combobox-list"
              aria-expanded
              aria-activedescendant={
                filtered[activeIndex]
                  ? `ds-combobox-opt-${filtered[activeIndex].value}`
                  : undefined
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder={searchPlaceholder}
              className="ds-combobox__search"
              autoComplete="off"
              spellCheck={false}
            />
            {clearable && value !== null && (
              <button
                type="button"
                className="ds-combobox__clear"
                onClick={() => commit(null)}
              >
                Clear
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="ds-combobox__empty">{emptyMessage}</div>
          ) : (
            <ul
              ref={listRef}
              id="ds-combobox-list"
              role="listbox"
              className="ds-combobox__list"
            >
              {filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIndex;
                return (
                  <li
                    key={opt.value}
                    id={`ds-combobox-opt-${opt.value}`}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "ds-combobox__item",
                      isActive && "ds-combobox__item--active",
                      isSelected && "ds-combobox__item--selected",
                    )}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => commit(opt)}
                  >
                    <span className="ds-combobox__item-label">{opt.label}</span>
                    {opt.hint && (
                      <span className="ds-combobox__item-hint">{opt.hint}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" d="M6 9l6 6 6-6" />
    </svg>
  );
}
