import { TEMPLATE_META } from './templates'

/**
 * Operator-authored theme blob as stored by the Go menu service
 * (`restaurant.theme` JSONB — mirrored here so this module stays free
 * of any DB import). Forward-compatible: unknown keys pass through.
 */
export type RestaurantTheme = {
  primaryColor?: string
  secondaryColor?: string
  font?: 'inter' | 'playfair' | 'lora' | 'space-grotesk'
  layout?: 'classic' | 'minimal' | 'editorial' | 'cards'
  [key: string]: unknown
}

// LAYOUTS is derived from the templates registry — single source of truth
// for which templates exist lives in ./templates/index.ts.
export const LAYOUTS = TEMPLATE_META

export const FONTS = [
  { id: 'inter', name: 'Inter', cssVar: '--font-inter' },
  { id: 'playfair', name: 'Playfair Display', cssVar: '--font-playfair' },
  { id: 'lora', name: 'Lora', cssVar: '--font-lora' },
  { id: 'space-grotesk', name: 'Space Grotesk', cssVar: '--font-space-grotesk' },
] as const satisfies ReadonlyArray<{
  id: NonNullable<RestaurantTheme['font']>
  name: string
  cssVar: string
}>

export type ResolvedTheme = Required<
  Pick<RestaurantTheme, 'primaryColor' | 'secondaryColor' | 'font' | 'layout'>
>

export const DEFAULT_THEME: ResolvedTheme = {
  layout: 'classic',
  font: 'inter',
  primaryColor: '#111111',
  secondaryColor: '#6b7280',
}

// Coerce the stored blob (possibly null/partial/legacy — or the untyped
// `Record<string, unknown>` the Go public payload carries) into a fully
// populated theme. Unknown layout/font values fall back to defaults rather
// than throw, so old rows or hand-edited JSON never crash the public page.
export function resolveTheme(
  theme: RestaurantTheme | Record<string, unknown> | null | undefined,
): ResolvedTheme {
  const t = (theme ?? {}) as RestaurantTheme
  const layoutIds = LAYOUTS.map((l) => l.id) as ReadonlyArray<string>
  const fontIds = FONTS.map((f) => f.id) as ReadonlyArray<string>
  return {
    layout:
      t.layout && layoutIds.includes(t.layout) ? t.layout : DEFAULT_THEME.layout,
    font: t.font && fontIds.includes(t.font) ? t.font : DEFAULT_THEME.font,
    primaryColor: isHex(t.primaryColor) ? t.primaryColor! : DEFAULT_THEME.primaryColor,
    secondaryColor: isHex(t.secondaryColor)
      ? t.secondaryColor!
      : DEFAULT_THEME.secondaryColor,
  }
}

export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

function isHex(v: string | undefined): boolean {
  return typeof v === 'string' && HEX_PATTERN.test(v)
}

export function fontCssVar(font: ResolvedTheme['font']): string {
  return FONTS.find((f) => f.id === font)!.cssVar
}
