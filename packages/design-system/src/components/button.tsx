import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Iedora button. Mono uppercase label, square corners. Variants are
 * **semantic** (intent-driven) so callers don't bake visuals into
 * route code:
 *
 *   - primary    — THE main destination CTA on a screen (cinnabar
 *                  solid). One per view. Hover inverts.
 *   - secondary  — neutral confirm / submit. Outlined ink → solid
 *                  hover. The form-submit default.
 *   - solid      — high-contrast neutral. Ink solid → outlined hover.
 *                  Used in dense surfaces where outline would get lost.
 *   - ghost      — borderless tertiary action. Hover draws a hairline.
 *                  Use for "Cancel" / "Skip" / inline links-as-buttons.
 *   - danger     — destructive (delete / kick / revoke). Cinnabar
 *                  outline → solid hover. Always second-confirm in UX.
 *
 * Sizes (`sm | md | lg`) pin the padding + font scale. NEVER reach
 * for `className="px-… text-xs"` to shrink a button — that drift was
 * the reason the surface looked broken before this canon. Add a new
 * size below if md/sm/lg are all wrong.
 *
 * `loading` shows the built-in spinner + disables the control. Pair
 * with form state (`disabled={pending}` ➜ `loading={pending}`) so the
 * label text doesn't have to swap.
 *
 * Renders as <a> when `href` is provided, otherwise <button>.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "solid"
  | "ghost"
  | "danger";

export type ButtonSize = "sm" | "md" | "lg";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Cinnabar arrow glyph on the right. `true` = default `↗`. */
  arrow?: boolean | ReactNode;
  /** Show inline spinner + disable the control. */
  loading?: boolean;
  children?: ReactNode;
  className?: string;
};

type AsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
    as?: "button";
    type?: "button" | "submit" | "reset";
    href?: never;
  };

type AsAnchorProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    as?: "a";
    href: string;
    type?: never;
  };

export type ButtonProps = AsButtonProps | AsAnchorProps;

function variantClass(variant: ButtonVariant | undefined): string {
  switch (variant) {
    case "primary":
      return "ds-btn--primary";
    case "solid":
      return "ds-btn--solid";
    case "ghost":
      return "ds-btn--ghost";
    case "danger":
      return "ds-btn--danger";
    case "secondary":
    case undefined:
      return "ds-btn--secondary";
  }
}

function sizeClass(size: ButtonSize | undefined): string {
  switch (size) {
    case "sm":
      return "ds-btn--sm";
    case "lg":
      return "ds-btn--lg";
    case "md":
    case undefined:
      return "";
  }
}

function isAnchor(props: ButtonProps): props is AsAnchorProps {
  return (props as AsAnchorProps).href !== undefined;
}

export function Button(props: ButtonProps) {
  const className = cn(
    "ds-btn",
    variantClass(props.variant),
    sizeClass(props.size),
    props.loading ? "ds-btn--loading" : null,
    props.className,
  );
  const disabled = Boolean(props.loading) || (props as { disabled?: boolean }).disabled;

  const content = (
    <>
      {props.loading ? (
        <span className="ds-btn__spinner" aria-hidden="true" />
      ) : null}
      <span>{props.children}</span>
      {props.arrow && !props.loading ? (
        <span className="ds-btn__arrow" aria-hidden="true">
          {props.arrow === true ? "↗" : props.arrow}
        </span>
      ) : null}
    </>
  );

  if (isAnchor(props)) {
    const {
      variant: _v,
      size: _s,
      arrow: _a,
      loading: _l,
      children: _c,
      className: _cls,
      as: _as,
      ...rest
    } = props;
    return (
      <a
        {...rest}
        className={className}
        aria-disabled={disabled || undefined}
        aria-busy={props.loading || undefined}
      >
        {content}
      </a>
    );
  }

  const {
    variant: _v,
    size: _s,
    arrow: _a,
    loading: _l,
    children: _c,
    className: _cls,
    as: _as,
    type,
    disabled: _disabled,
    ...rest
  } = props;
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={className}
      disabled={disabled}
      aria-busy={props.loading || undefined}
    >
      {content}
    </button>
  );
}
