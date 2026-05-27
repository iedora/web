import { Button } from "./button";
import { cn } from "../lib/cn";

/**
 * Iedora Manual § VI — Pagination.
 *
 * Three-slot row: prev / status / next. Each slot owns one job. The
 * component is a pure renderer — no router, no hooks, no URL knowledge.
 * Build the previous + next hrefs at the call site (server pages can
 * read `searchParams` directly; client pages can wire `usePathname`),
 * then drop them in. The component renders `<a>` elements through
 * `<Button as="a">` so client routers still pick them up.
 *
 *   <Pagination
 *     prevHref={pageHref(params, page - 1)}
 *     nextHref={pageHref(params, page + 1)}
 *     prevLabel="Prev"
 *     nextLabel="Next"
 *     status={`Page ${page} of ${totalPages}`}
 *     isFirst={page <= 1}
 *     isLast={page >= totalPages}
 *   />
 */
export type PaginationProps = {
  prevHref: string;
  nextHref: string;
  prevLabel: string;
  nextLabel: string;
  /** Anything renderable in the middle slot — typically "Page X of Y". */
  status?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  /** Forwarded to the wrapping `<nav>`. */
  "aria-label"?: string;
  "data-test-id"?: string;
  className?: string;
};

export function Pagination({
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
  status,
  isFirst,
  isLast,
  "aria-label": ariaLabel = "Pagination",
  "data-test-id": testId,
  className,
}: PaginationProps) {
  const ns = (s: string) => (testId ? `${testId}-${s}` : undefined);
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "mt-4 flex items-center justify-between gap-3 text-xs",
        className,
      )}
      data-test-id={testId}
    >
      <Button
        as="a"
        href={prevHref}
        variant="ghost"
        aria-disabled={isFirst ? true : undefined}
        data-test-id={ns("prev")}
      >
        ← {prevLabel}
      </Button>
      {status ? (
        <span
          className="text-[var(--ink-70)]"
          data-test-id={ns("status")}
        >
          {status}
        </span>
      ) : null}
      <Button
        as="a"
        href={nextHref}
        variant="ghost"
        aria-disabled={isLast ? true : undefined}
        data-test-id={ns("next")}
      >
        {nextLabel} →
      </Button>
    </nav>
  );
}
