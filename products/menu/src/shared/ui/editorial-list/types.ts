import type { ReactNode } from 'react'

export type EditorialStatus = {
  /**
   * Free-form key the caller supplies — `'live'`, `'draft'`, `'active'`,
   * `'disabled'`, etc. The pill component renders distinct visual variants
   * for `live` and `active` (positive) vs everything else (muted).
   */
  kind: string
  label: string
}

/**
 * One action chip on the right of an editorial row's sub-line.
 * Renders as a `<Link>` so it's reachable by keyboard and parses as plain
 * navigation without JS.
 */
export type EditorialAction = {
  key: string
  label: string
  href: string
  /** Optional override for accessible label (defaults to `label`). */
  ariaLabel?: string
}

/**
 * Trailing metric on the right of a row — designed for scan counts.
 * `value: null` renders as an em-dash so a draft row with no data still
 * has visual weight in the column. Omit the whole field when the page
 * isn't presenting trailing metrics at all (then the column collapses).
 */
export type EditorialTrailing = {
  value: number | null
  /** Direction-aware delta: positive = up, negative = down. */
  deltaPct?: number
  /** Tiny serif italic line below the value, e.g. "vs. last month". */
  comparison?: string
}

export type EditorialRow = {
  id: string
  /** Where the title link points. Required so the row is keyboard navigable. */
  href: string
  title: string
  /**
   * Subtitle is composed of slots so the page can mix free-form text
   * (location, slug) with a status pill and a relative-time mark without
   * the row component having to know about each one. Rendered separated
   * by `· ` dots.
   */
  subtitle: ReactNode
  /** "01.", "02." numbering — the row prepends these as a tiny serif italic.
   *  Omit (or pass empty) when the list has a single row; numbering noise on
   *  one item dilutes the editorial intent of the column. */
  index?: string
  /**
   * Sub-line metadata, e.g. "2 menus · 14 dishes". Pre-formatted by the page.
   */
  metadata?: string
  actions?: EditorialAction[]
  /**
   * Custom interactive elements rendered alongside the action chips.
   * Use this when the action is not a plain Link — e.g. a server action
   * button with a confirmation dialog. Rendered after the link chips.
   */
  extraActions?: ReactNode
  trailing?: EditorialTrailing
}
