import 'server-only'
import type { LanguageCode, LocalizedText } from '@/features/i18n'

// Sample data for the "Sample menu" button. English is required as the
// source-of-truth string; other registered languages are optional. At seed
// time we pick the restaurant's defaultLanguage from this object for the
// plain `name`/`description` columns and store the rest as i18n overrides.

type LocalizedField = { en: string } & Partial<Record<LanguageCode, string>>

type SampleItemData = {
  name: LocalizedField
  description: LocalizedField
  priceCents: number
}

type SampleCategoryData = {
  name: LocalizedField
  items: ReadonlyArray<SampleItemData>
}

// Container name for the seeded menu. Visible to the admin in the menu list
// and to public visitors when the restaurant has more than one menu.
export const SAMPLE_MENU_NAME: LocalizedField = {
  en: 'Sample menu',
  pt: 'Menu de exemplo',
}

export const SAMPLE_MENU: ReadonlyArray<SampleCategoryData> = [
  {
    name: { en: 'Starters', pt: 'Entradas' },
    items: [
      {
        name: { en: 'Bruschetta', pt: 'Bruschetta' },
        description: { en: 'Tomato, basil, olive oil', pt: 'Tomate, manjericão, azeite' },
        priceCents: 650,
      },
      {
        name: { en: 'Calamari', pt: 'Lulas' },
        description: { en: 'Lemon mayo, fennel salad', pt: 'Maionese de limão, salada de funcho' },
        priceCents: 800,
      },
      {
        name: { en: 'Burrata', pt: 'Burrata' },
        description: { en: 'Marinated tomatoes, sourdough', pt: 'Tomates marinados, pão de massa-mãe' },
        priceCents: 950,
      },
    ],
  },
  {
    name: { en: 'Mains', pt: 'Pratos principais' },
    items: [
      {
        name: { en: 'Spaghetti Carbonara', pt: 'Esparguete à carbonara' },
        description: {
          en: 'Guanciale, pecorino, black pepper',
          pt: 'Guanciale, pecorino, pimenta preta',
        },
        priceCents: 1400,
      },
      {
        name: { en: 'Risotto Funghi', pt: 'Risoto de cogumelos' },
        description: {
          en: 'Porcini, truffle oil',
          pt: 'Porcini, óleo de trufa',
        },
        priceCents: 1550,
      },
      {
        name: { en: 'Steak frites', pt: 'Bife com batatas' },
        description: {
          en: 'House cut, peppercorn jus',
          pt: 'Corte da casa, molho de pimenta',
        },
        priceCents: 1900,
      },
    ],
  },
  {
    name: { en: 'Desserts', pt: 'Sobremesas' },
    items: [
      {
        name: { en: 'Tiramisu', pt: 'Tiramisu' },
        description: { en: 'Espresso, mascarpone', pt: 'Café, mascarpone' },
        priceCents: 700,
      },
      {
        name: { en: 'Panna cotta', pt: 'Panna cotta' },
        description: { en: 'Berries, vanilla', pt: 'Frutos vermelhos, baunilha' },
        priceCents: 650,
      },
    ],
  },
]

// Pick the plain-text value for a field given the restaurant's default
// language. English is the registered fallback (every entry must define it).
export function pickDefault(
  field: LocalizedField,
  defaultLanguage: LanguageCode,
): string {
  return field[defaultLanguage] ?? field.en
}

// Build the i18n overrides map for a sample field: include every supported
// language *other* than the default, when a translation exists. Returns null
// when no overrides apply (matches the column's null contract).
export function buildI18n(
  field: LocalizedField,
  defaultLanguage: LanguageCode,
  supportedLanguages: ReadonlyArray<LanguageCode>,
): LocalizedText | null {
  const out: LocalizedText = {}
  for (const lang of supportedLanguages) {
    if (lang === defaultLanguage) continue
    const value = field[lang]
    if (typeof value === 'string') out[lang] = value
  }
  return Object.keys(out).length === 0 ? null : out
}
