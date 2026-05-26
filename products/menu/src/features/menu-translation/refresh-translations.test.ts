import { describe, expect, it, vi } from 'vitest'
import type { LanguageCode } from '@/features/i18n'
import type {
  StaleRow,
  TranslatableField,
  TranslationDataPort,
  TranslationPort,
  WriteUpdate,
} from './ports'
import { refreshTranslations } from './use-cases/refresh-translations'

vi.mock('server-only', () => ({}))

function makeData({
  defaultLanguage = 'pt' as LanguageCode,
  supportedLanguages = ['pt', 'en'] as LanguageCode[],
  stale = [] as StaleRow[],
  onApply,
}: {
  defaultLanguage?: LanguageCode
  supportedLanguages?: LanguageCode[]
  stale?: StaleRow[]
  onApply?: (updates: ReadonlyArray<WriteUpdate>) => void
} = {}): TranslationDataPort {
  return {
    async getRestaurantLanguageConfig() {
      return { defaultLanguage, supportedLanguages }
    },
    async findStale() {
      return stale
    },
    async applyTranslations(_restaurantId, updates) {
      onApply?.(updates)
    },
  }
}

function makeTranslator(
  impl: (fields: TranslatableField[], to: LanguageCode[]) =>
    Record<string, Partial<Record<LanguageCode, string>>>,
): TranslationPort {
  return {
    async translate({ fields, toLanguages }) {
      const map = impl(fields, toLanguages)
      return fields.map((f) => ({
        ...f,
        translations: map[`${f.rowKind}:${f.id}:${f.field}`] ?? {},
      }))
    },
  }
}

describe('refreshTranslations', () => {
  it('no-ops cleanly when only the default language is supported', async () => {
    const result = await refreshTranslations(
      makeData({ defaultLanguage: 'pt', supportedLanguages: ['pt'] }),
      makeTranslator(() => ({})),
      { restaurantId: 'r-1' },
    )
    expect(result).toEqual({ ok: false, reason: 'no-targets', staleRows: 0 })
  })

  it('no-ops when no rows are stale', async () => {
    const result = await refreshTranslations(
      makeData({ supportedLanguages: ['pt', 'en'], stale: [] }),
      makeTranslator(() => ({})),
      { restaurantId: 'r-1' },
    )
    expect(result).toEqual({
      ok: false,
      reason: 'nothing-stale',
      staleRows: 0,
    })
  })

  it('translates stale rows and writes back merged i18n maps', async () => {
    const captured: WriteUpdate[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Bacalhau à brás',
          nameI18n: null,
          description: 'cod, eggs, potato straws',
          descriptionI18n: null,
        },
        {
          rowKind: 'category',
          id: 'c-1',
          name: 'Pratos principais',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
        },
      ],
      onApply: (u) => captured.push([...u]),
    })

    const translator = makeTranslator((fields) => {
      const out: Record<string, Partial<Record<LanguageCode, string>>> = {}
      for (const f of fields) {
        out[`${f.rowKind}:${f.id}:${f.field}`] = {
          en:
            f.field === 'name'
              ? `${f.text} [EN]`
              : `${f.text} (translated)`,
        }
      }
      return out
    })

    const result = await refreshTranslations(data, translator, {
      restaurantId: 'r-1',
    })

    expect(result).toEqual({
      ok: true,
      staleRows: 2,
      translatedFields: 3, // 2 names + 1 description
      targetLanguages: ['en'],
    })

    expect(captured).toHaveLength(1)
    const [updates] = captured
    expect(updates).toHaveLength(2)
    const item = updates!.find((u) => u.rowKind === 'item')
    expect(item?.nameI18n).toEqual({ en: 'Bacalhau à brás [EN]' })
    expect(item?.descriptionI18n).toEqual({
      en: 'cod, eggs, potato straws (translated)',
    })
    const cat = updates!.find((u) => u.rowKind === 'category')
    expect(cat?.nameI18n).toEqual({ en: 'Pratos principais [EN]' })
    // No description on the stale category → no descriptionI18n produced.
    expect(cat?.descriptionI18n).toBeNull()
  })

  it('preserves existing translations in non-target languages', async () => {
    const captured: WriteUpdate[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Café',
          // Pre-existing French translation must survive the sync even
          // though `fr` isn't in the current target set.
          nameI18n: { fr: 'Café (FR, manual)' },
          description: null,
          descriptionI18n: null,
        },
      ],
      onApply: (u) => captured.push([...u]),
    })

    const result = await refreshTranslations(
      data,
      makeTranslator((fields) => {
        const out: Record<string, Partial<Record<LanguageCode, string>>> = {}
        for (const f of fields) out[`${f.rowKind}:${f.id}:${f.field}`] = { en: 'Coffee' }
        return out
      }),
      { restaurantId: 'r-1' },
    )

    expect(result.ok).toBe(true)
    const [updates] = captured
    expect(updates![0]?.nameI18n).toEqual({
      fr: 'Café (FR, manual)',
      en: 'Coffee',
    })
  })

  it('still bumps the sync timestamp for stale rows even when the translator returned nothing', async () => {
    const captured: WriteUpdate[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Cozido à portuguesa',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
        },
      ],
      onApply: (u) => captured.push([...u]),
    })

    // Translator returns empty for every field — provider hiccup.
    await refreshTranslations(data, makeTranslator(() => ({})), {
      restaurantId: 'r-1',
    })

    // We still send a write so `translations_synced_at` advances; the
    // existing nameI18n stays null because no translation came back.
    expect(captured).toHaveLength(1)
    expect(captured[0]).toHaveLength(1)
    expect(captured[0]![0]?.nameI18n).toBeNull()
  })

  it('surfaces a translator-failed result without bumping the sync timestamp', async () => {
    const captured: WriteUpdate[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Bacalhau',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
        },
      ],
      onApply: (u) => captured.push([...u]),
    })
    const translator: TranslationPort = {
      async translate() {
        const err = new Error('Kimi 503') as Error & {
          failedLanguages?: LanguageCode[]
        }
        err.failedLanguages = ['en']
        throw err
      },
    }

    const result = await refreshTranslations(data, translator, {
      restaurantId: 'r-1',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    if (result.reason !== 'translator-failed') {
      throw new Error(`expected translator-failed, got ${result.reason}`)
    }
    expect(result.failedLanguages).toEqual(['en'])
    expect(result.message).toContain('Kimi 503')
    // Critical: we did NOT write — translations_synced_at stays old so
    // the next click retries the same rows.
    expect(captured).toEqual([])
  })

  it('honours operator-picked target languages over the supported set', async () => {
    const seen: LanguageCode[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en', 'es', 'fr'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Polvo',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
        },
      ],
    })
    const translator: TranslationPort = {
      async translate({ toLanguages, fields }) {
        seen.push([...toLanguages])
        return fields.map((f) => ({ ...f, translations: {} }))
      },
    }

    await refreshTranslations(data, translator, {
      restaurantId: 'r-1',
      targetLanguages: ['en'],
    })
    expect(seen[0]).toEqual(['en'])
  })

  it('filters operator picks to the supported set + drops the default', async () => {
    const seen: LanguageCode[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Polvo',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
        },
      ],
    })
    const translator: TranslationPort = {
      async translate({ toLanguages, fields }) {
        seen.push([...toLanguages])
        return fields.map((f) => ({ ...f, translations: {} }))
      },
    }

    // Operator asked for `es` (not supported) + `pt` (the default) +
    // `en`. Use-case should narrow to ['en'].
    await refreshTranslations(data, translator, {
      restaurantId: 'r-1',
      targetLanguages: ['es', 'pt', 'en'],
    })
    expect(seen[0]).toEqual(['en'])
  })

  it('drops translation targets that match the default language', async () => {
    // Defensive against a misconfigured supportedLanguages where the
    // default is listed once and we try to translate pt → pt.
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en', 'pt'] as unknown as LanguageCode[],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Polvo',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
        },
      ],
    })

    const seenTargets: LanguageCode[][] = []
    const translator: TranslationPort = {
      async translate({ toLanguages, fields }) {
        seenTargets.push([...toLanguages])
        return fields.map((f) => ({ ...f, translations: {} }))
      },
    }

    const result = await refreshTranslations(data, translator, {
      restaurantId: 'r-1',
    })
    expect(result.ok).toBe(true)
    // 'pt' is filtered out — even when it appears in supportedLanguages.
    expect(seenTargets[0]).not.toContain('pt')
    expect(seenTargets[0]).toContain('en')
  })

  it('translates variant labels alongside name + description and merges into labelI18n', async () => {
    const captured: WriteUpdate[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Bacalhau',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
          variants: [
            { label: 'Dose', priceCents: 1500 },
            // Pre-existing FR translation must survive the EN-only sync.
            { label: 'Meia dose', labelI18n: { fr: 'Demi' }, priceCents: 800 },
            // Empty label — operator started a row and didn't fill it.
            // Must be skipped to save tokens.
            { label: '', priceCents: 0 },
          ],
        },
      ],
      onApply: (u) => captured.push([...u]),
    })

    const seenFields: string[] = []
    const translator = makeTranslator((fields) => {
      const out: Record<string, Partial<Record<LanguageCode, string>>> = {}
      for (const f of fields) {
        seenFields.push(f.field)
        const key = `${f.rowKind}:${f.id}:${f.field}`
        if (f.field === 'name') out[key] = { en: 'Cod' }
        if (f.field === 'variant:0') out[key] = { en: 'Full' }
        if (f.field === 'variant:1') out[key] = { en: 'Half' }
      }
      return out
    })

    const result = await refreshTranslations(data, translator, {
      restaurantId: 'r-1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    // name + 2 non-empty variant labels = 3 fields (empty variant skipped).
    expect(result.translatedFields).toBe(3)
    expect(seenFields).toEqual(['name', 'variant:0', 'variant:1'])

    const [updates] = captured
    const it = updates![0]
    expect(it?.nameI18n).toEqual({ en: 'Cod' })
    // Variant labels round-trip with translations merged; priceCents
    // unchanged; the empty-labelled variant is preserved as-is.
    expect(it?.variants).toEqual([
      { label: 'Dose', labelI18n: { en: 'Full' }, priceCents: 1500 },
      {
        label: 'Meia dose',
        labelI18n: { fr: 'Demi', en: 'Half' },
        priceCents: 800,
      },
      { label: '', labelI18n: null, priceCents: 0 },
    ])
  })

  it('item rows without variants pass through unchanged (no variants key written)', async () => {
    const captured: WriteUpdate[][] = []
    const data = makeData({
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      stale: [
        {
          rowKind: 'item',
          id: 'i-1',
          name: 'Café',
          nameI18n: null,
          description: null,
          descriptionI18n: null,
          // variants undefined — the adapter never read them (or the
          // item never had any).
        },
      ],
      onApply: (u) => captured.push([...u]),
    })

    await refreshTranslations(
      data,
      makeTranslator(() => ({})),
      { restaurantId: 'r-1' },
    )

    const [updates] = captured
    // No variants key on the WriteUpdate → adapter leaves the column
    // alone. Critical: we don't accidentally NULL out variants on an
    // item that has them just because the row had no translatable
    // labels in this batch.
    expect(updates![0]).not.toHaveProperty('variants')
  })
})
