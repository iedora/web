import type { RestaurantTheme } from '@/shared/db/schema'
import { TEMPLATE_META } from './templates'

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

// Coerce DB row (possibly null/partial/legacy) into a fully populated theme.
// Unknown layout/font values fall back to defaults rather than throw, so old
// rows or hand-edited jsonb never crash the public page.
export function resolveTheme(theme: RestaurantTheme | null | undefined): ResolvedTheme {
  const layoutIds = LAYOUTS.map((l) => l.id) as ReadonlyArray<string>
  const fontIds = FONTS.map((f) => f.id) as ReadonlyArray<string>
  return {
    layout:
      theme?.layout && layoutIds.includes(theme.layout)
        ? theme.layout
        : DEFAULT_THEME.layout,
    font: theme?.font && fontIds.includes(theme.font) ? theme.font : DEFAULT_THEME.font,
    primaryColor: isHex(theme?.primaryColor) ? theme!.primaryColor! : DEFAULT_THEME.primaryColor,
    secondaryColor: isHex(theme?.secondaryColor)
      ? theme!.secondaryColor!
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
