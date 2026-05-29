import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/* ─────────────────────────────────────────────────────────────
 * Printed-menu chrome — five shared primitives that compose the
 * "card laid on the table" surfaces (onboarding, auth flow, focused
 * single-task pages). All five read CSS tokens from @iedora/design-
 * system/tokens.css so a palette tweak propagates without touching
 * any consumer. None of them carry state; pure JSX wrappers.
 * ─────────────────────────────────────────────────────────────  */

/* ── <Stage> ─ page-level paper background + optional grain + vignette */

type StageProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  /** When true (default) renders the paper grain SVG overlay + radial
   *  vignette via fixed-position pseudo-elements. Disable on surfaces
   *  that already own their own page-level texture. */
  grain?: boolean;
};

export function Stage({ className, grain = true, children, ...rest }: StageProps) {
  return (
    <main
      {...rest}
      className={cn("ds-stage", !grain && "ds-stage--flat", className)}
    >
      {children}
    </main>
  );
}

/* ── <ActionCard> ─ a button that reads like a printed-menu chip.
 *    Square, hairline-bordered, with a centered cinnabar glyph +
 *    Playfair title + Geist Mono hint. Single visual treatment — when
 *    two ActionCards sit side-by-side they read as equal weight.
 *    Hover inverts to ink fill so the chip becomes the dominant
 *    element while pressed. Used in the AI-import wizards and
 *    anywhere a focused-task surface offers paired actions.
 */

type ActionCardProps = HTMLAttributes<HTMLButtonElement> & {
  /** Big centred line — set in Playfair Display 500. */
  title: ReactNode;
  /** Geist Mono uppercase hint underneath. */
  hint?: ReactNode;
  /** Optional glyph rendered above the title (e.g. ◉ / ↑ / ❧). Always
   *  rendered in cinnabar italic Playfair. */
  glyph?: ReactNode;
  disabled?: boolean;
};

export function ActionCard({
  title,
  hint,
  glyph,
  className,
  disabled,
  children,
  ...rest
}: ActionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...rest}
      className={cn("ds-action-card", className)}
    >
      {glyph && (
        <span className="ds-action-card__glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span className="ds-action-card__title">{title}</span>
      {hint && <span className="ds-action-card__hint">{hint}</span>}
      {children}
    </button>
  );
}

/* ── <PaperCard> ─ letterpress chrome: double hairline frame, drop shadow */

type PaperCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function PaperCard({ className, children, ...rest }: PaperCardProps) {
  return (
    <div {...rest} className={cn("ds-paper-card", className)}>
      <div className="ds-paper-card__inner">{children}</div>
    </div>
  );
}

/* ── <Masthead> ─ wordmark + course italic. Replaces ad-hoc inline
 *    composition of <Wordmark> with a serif eyebrow underneath. */

type MastheadProps = HTMLAttributes<HTMLElement> & {
  /** The wordmark text (renders with a clay-red letterpress dot). */
  word?: string;
  /** The italic course line under the wordmark (e.g. "first course"). */
  course?: string;
};

export function Masthead({
  word = "menu",
  course,
  className,
  ...rest
}: MastheadProps) {
  return (
    <header {...rest} className={cn("ds-masthead", className)}>
      <span className="ds-masthead__word" role="img" aria-label={`${word}.`}>
        {word}
        <span className="ds-masthead__dot" aria-hidden="true" />
      </span>
      {course && (
        <div className="ds-masthead__course">
          <em>·</em> {course} <em>·</em>
        </div>
      )}
    </header>
  );
}

/* ── <OrnamentRule> ─ hairline · fleuron · hairline section break */

type OrnamentRuleProps = HTMLAttributes<HTMLDivElement> & {
  /** The centre glyph. Defaults to `❦`; pick `❧` for the second course
   *  (mirrors the design's "two pillars" pattern). */
  fleuron?: string;
};

export function OrnamentRule({
  fleuron = "❦",
  className,
  ...rest
}: OrnamentRuleProps) {
  return (
    <div {...rest} className={cn("ds-ornament", className)} aria-hidden="true">
      <span className="ds-ornament__ln" />
      <span className="ds-ornament__fleuron">{fleuron}</span>
      <span className="ds-ornament__ln ds-ornament__ln--r" />
    </div>
  );
}

/* ── <DottedStepper> ─ pip · label, joined by a dotted hairline rule.
 *    Pair with the existing Stepper export when a pill-chip
 *    interaction is the right read; pick this one for the letterpress
 *    chrome on focused-task surfaces. */

export type DottedStepperStep = {
  /** Stable identifier — matched against `currentKey` to resolve state. */
  key: string;
  /** 1-indexed position used to derive done/current/pending state. */
  index: number;
  /** Already-localised label rendered next to the pip. */
  label: string;
};

export type DottedStepperProps = {
  steps: ReadonlyArray<DottedStepperStep>;
  /** Key of the active step. Must match one of `steps[i].key`. */
  currentKey: string;
  /** Already-localised `aria-label` on the <ol>. */
  ariaLabel: string;
  /** Already-localised "Step N of M" string. Omit to hide the counter. */
  counterLabel?: string;
  /** Test hook injected on the wrapper. */
  testId?: string;
  /** Per-step test-id factory. */
  stepTestId?: (key: string) => string;
  className?: string;
};

function resolveState(
  step: DottedStepperStep,
  currentIndex: number,
): "done" | "current" | "pending" {
  if (step.index === currentIndex) return "current";
  return step.index < currentIndex ? "done" : "pending";
}

export function DottedStepper({
  steps,
  currentKey,
  ariaLabel,
  counterLabel,
  testId,
  stepTestId,
  className,
}: DottedStepperProps) {
  const current = steps.find((s) => s.key === currentKey);
  const currentIndex = current?.index ?? 1;
  return (
    <div className={cn("ds-dstepper", className)}>
      <ol className="ds-dstepper__rail" aria-label={ariaLabel} data-test-id={testId}>
        {steps.map((step, i) => {
          const state = resolveState(step, currentIndex);
          return (
            <li
              key={step.key}
              className={cn(
                "ds-dstepper__node",
                state === "done" && "ds-dstepper__node--done",
                state === "current" && "ds-dstepper__node--current",
              )}
              data-test-id={stepTestId?.(step.key)}
            >
              <span className="ds-dstepper__pip" />
              {step.label}
              {i < steps.length - 1 && (
                <span className="ds-dstepper__rule" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
      {counterLabel && (
        <p className="ds-dstepper__counter" data-test-id={`${testId ?? "ds-dstepper"}-counter`}>
          {counterLabel}
        </p>
      )}
    </div>
  );
}
