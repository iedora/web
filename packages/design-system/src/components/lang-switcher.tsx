"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export type LangOption = {
  /** Stable identifier persisted by the host (e.g. "en", "pt"). */
  code: string;
  /** Accessible name (`English`, `Português`). Used as aria-label + title. */
  name: string;
  /** Emoji flag or any 1-2 glyph short label. Rendered aria-hidden. */
  flag: string;
};

export type LangSwitcherProps = {
  /** Available languages — order is preserved in the inline row. */
  langs: readonly LangOption[];
  /** Currently selected code. Must match one of `langs[].code`. */
  value: string;
  /** Called when the user picks a language. */
  onChange: (code: string) => void;
  /** aria-label for the group wrapper. Defaults to `"Language"`. */
  ariaLabel?: string;
  /**
   * Prefix used to build `data-test-id` per language button
   * (e.g. `landing-lang` → `landing-lang-en`). When omitted the
   * attribute is not emitted.
   */
  testIdPrefix?: string;
  className?: string;
};

/**
 * Editorial language picker. Two child layouts gated by CSS:
 *   - `.ds-lang__row` is the default inline row of flag chips (tablet+).
 *   - `.ds-lang__compact` is a single trigger that opens a popover
 *      listing the other languages — revealed under 520px.
 *
 * Both layouts call the same `onChange`, so the host has one source of
 * truth. The component is client-only because it tracks popover state.
 */
export function LangSwitcher({
  langs,
  value,
  onChange,
  ariaLabel = "Language",
  testIdPrefix,
  className,
}: LangSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const current = langs.find((l) => l.code === value) ?? langs[0];

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const testId = (code: string) =>
    testIdPrefix ? { "data-test-id": `${testIdPrefix}-${code}` } : {};

  if (!current) return null;

  return (
    <div
      ref={rootRef}
      className={cn("ds-lang", className)}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="ds-lang__row">
        {langs.map((l) => (
          <button
            key={l.code}
            type="button"
            className={cn("ds-lang__btn", value === l.code && "ds-lang__btn--active")}
            onClick={() => onChange(l.code)}
            title={l.name}
            aria-label={l.name}
            aria-pressed={value === l.code}
            {...testId(l.code)}
          >
            <span className="ds-lang__flag" aria-hidden="true">{l.flag}</span>
          </button>
        ))}
      </div>
      <div className="ds-lang__compact">
        <button
          type="button"
          className="ds-lang__btn ds-lang__trigger"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={current.name}
          {...(testIdPrefix ? { "data-test-id": `${testIdPrefix}-trigger` } : {})}
        >
          <span className="ds-lang__flag" aria-hidden="true">{current.flag}</span>
        </button>
        {open && (
          <div className="ds-lang__pop" role="menu">
            {langs
              .filter((l) => l.code !== value)
              .map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="menuitem"
                  className="ds-lang__btn"
                  onClick={() => {
                    onChange(l.code);
                    setOpen(false);
                  }}
                  title={l.name}
                  aria-label={l.name}
                  {...testId(l.code)}
                >
                  <span className="ds-lang__flag" aria-hidden="true">{l.flag}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
