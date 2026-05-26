/**
 * Real-Postgres tests for the restaurant-identity adapter — specifically
 * the promote-on-switch transaction in `updateLanguageSettings`. The
 * per-row math is unit-tested in `use-cases/promote-default-language.test.ts`;
 * THIS file proves the adapter glue:
 *
 *   - reads the right columns from restaurant + category + item
 *   - writes back inside one transaction
 *   - leaves rows untouched when the default didn't change
 *   - counts promoted + needsAttention correctly across all four
 *     translatable surfaces (restaurant.description, category name +
 *     description, item name + description, item.variants[].label)
 *
 * Stubs the env vars the same way `menu-builder/adapters/drizzle.test.ts`
 * does — the prod singleton at the bottom of the adapter module
 * imports `@/shared/db/client`, which loads `@/shared/env`.
 */
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test'
process.env.CORE_DATABASE_URL ||= 'postgres://test:test@localhost/core_test'
process.env.IEDORA_CORE_SECRET ||= 'a'.repeat(48)
process.env.IEDORA_CORE_BASE_URL ||= 'http://localhost:3000'
process.env.NEXT_PUBLIC_CORE_URL ||= 'http://localhost:3000/core'
process.env.MENU_PUBLIC_URL ||= 'http://localhost:3000'
process.env.S3_ENDPOINT ||= 'http://localhost:4566'
process.env.S3_REGION ||= 'us-east-1'
process.env.S3_ACCESS_KEY ||= 'test'
process.env.S3_SECRET_KEY ||= 'test'
process.env.S3_BUCKET ||= 'test'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

const { makeDrizzleIdentityWrite } = await import('./drizzle')
import type { IdentityWritePort } from '../ports'
import { makeTestDb, type TestDb } from '@/shared/testing/pglite'
import {
  category,
  item,
  menu,
  restaurant,
  type ItemVariant,
} from '@/shared/db/schema'
import type { LocalizedText } from '@/features/i18n'

let t: TestDb
let writer: IdentityWritePort

beforeEach(async () => {
  t = await makeTestDb()
  writer = makeDrizzleIdentityWrite(t.db)
})

afterEach(async () => {
  await t.cleanup()
})

/** Sets up a PT-default restaurant with EN translations on every
 *  translatable surface. Returns the IDs the test will assert on. */
async function seedRestaurantWithTranslations() {
  const orgId = 'o-1'
  const restaurantId = 'r-1'
  const menuId = 'm-1'
  const catId = 'c-1'
  const itemId = 'i-1'

  await t.db.insert(restaurant).values({
    id: restaurantId,
    organizationId: orgId,
    name: 'O Bom Garfo',
    slug: 'o-bom-garfo',
    defaultLanguage: 'pt',
    supportedLanguages: ['pt', 'en'],
    description: 'Tasca em Lisboa',
    descriptionI18n: { en: 'Tavern in Lisbon' } as LocalizedText,
  })
  await t.db.insert(menu).values({
    id: menuId,
    restaurantId,
    name: 'Carta',
    nameI18n: { en: 'Menu' } as LocalizedText,
    position: 0,
  })
  await t.db.insert(category).values({
    id: catId,
    menuId,
    restaurantId,
    name: 'Pratos principais',
    nameI18n: { en: 'Main courses' } as LocalizedText,
    description: 'Servidos com batata frita',
    descriptionI18n: { en: 'Served with chips' } as LocalizedText,
    position: 0,
  })
  await t.db.insert(item).values({
    id: itemId,
    categoryId: catId,
    restaurantId,
    name: 'Bacalhau à brás',
    nameI18n: { en: 'Cod à brás' } as LocalizedText,
    description: 'Bacalhau desfiado, ovo, batata palha',
    descriptionI18n: { en: 'Shredded cod, egg, potato sticks' } as LocalizedText,
    priceCents: 1500,
    variants: [
      { label: 'Dose', labelI18n: { en: 'Full' }, priceCents: 1500 },
      { label: 'Meia dose', labelI18n: { en: 'Half' }, priceCents: 800 },
    ] satisfies ItemVariant[],
    position: 0,
  })
  return { restaurantId, catId, itemId }
}

describe('drizzleIdentityWrite.updateLanguageSettings — promote-on-switch', () => {
  it('no-ops the promotion when defaultLanguage is unchanged', async () => {
    const { restaurantId, catId, itemId } = await seedRestaurantWithTranslations()
    const before = await t.db
      .select()
      .from(item)
      .where(eq(item.id, itemId))
      .limit(1)

    const stats = await writer.updateLanguageSettings(restaurantId, {
      defaultLanguage: 'pt',
      // Add fr to supported set — the column SHOULD update, but no
      // promotion runs because the default itself didn't change.
      supportedLanguages: ['pt', 'en', 'fr'],
    })

    expect(stats.defaultChanged).toBe(false)
    expect(stats.rowsPromoted).toBe(0)
    expect(stats.rowsNeedingAttention).toBe(0)

    // Item row is byte-for-byte unchanged on the translatable columns.
    const [after] = await t.db
      .select()
      .from(item)
      .where(eq(item.id, itemId))
      .limit(1)
    expect(after?.name).toBe(before[0]?.name)
    expect(after?.nameI18n).toEqual(before[0]?.nameI18n)
    expect(after?.variants).toEqual(before[0]?.variants)

    // But the language config did change.
    const [r] = await t.db
      .select()
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1)
    expect(r?.supportedLanguages).toEqual(['pt', 'en', 'fr'])
    expect(r?.defaultLanguage).toBe('pt')

    // Cat shouldn't have been touched either.
    const [c] = await t.db
      .select()
      .from(category)
      .where(eq(category.id, catId))
      .limit(1)
    expect(c?.name).toBe('Pratos principais')
  })

  it('rotates restaurant + category + item + variant translations atomically when default switches', async () => {
    const { restaurantId, catId, itemId } = await seedRestaurantWithTranslations()

    const stats = await writer.updateLanguageSettings(restaurantId, {
      defaultLanguage: 'en',
      supportedLanguages: ['pt', 'en'],
    })

    expect(stats.defaultChanged).toBe(true)
    // 1 (restaurant.description) + 2 (category.name + description) +
    // 2 (item.name + description) + 2 (variant labels) = 7 rows promoted.
    expect(stats.rowsPromoted).toBe(7)
    expect(stats.rowsNeedingAttention).toBe(0)

    // Restaurant: description swapped, old PT goes to i18n[pt].
    const [r] = await t.db
      .select()
      .from(restaurant)
      .where(eq(restaurant.id, restaurantId))
      .limit(1)
    expect(r?.defaultLanguage).toBe('en')
    expect(r?.description).toBe('Tavern in Lisbon')
    expect(r?.descriptionI18n).toEqual({ pt: 'Tasca em Lisboa' })

    // Category: name + description rotated.
    const [c] = await t.db
      .select()
      .from(category)
      .where(eq(category.id, catId))
      .limit(1)
    expect(c?.name).toBe('Main courses')
    expect(c?.nameI18n).toEqual({ pt: 'Pratos principais' })
    expect(c?.description).toBe('Served with chips')
    expect(c?.descriptionI18n).toEqual({ pt: 'Servidos com batata frita' })

    // Item: name + description + every variant label rotated.
    const [it] = await t.db
      .select()
      .from(item)
      .where(eq(item.id, itemId))
      .limit(1)
    expect(it?.name).toBe('Cod à brás')
    expect(it?.nameI18n).toEqual({ pt: 'Bacalhau à brás' })
    expect(it?.description).toBe('Shredded cod, egg, potato sticks')
    expect(it?.descriptionI18n).toEqual({
      pt: 'Bacalhau desfiado, ovo, batata palha',
    })
    expect(it?.variants).toEqual([
      { label: 'Full', labelI18n: { pt: 'Dose' }, priceCents: 1500 },
      { label: 'Half', labelI18n: { pt: 'Meia dose' }, priceCents: 800 },
    ])
  })

  it('counts rows needing attention when translations are missing', async () => {
    const orgId = 'o-2'
    const restaurantId = 'r-2'
    const menuId = 'm-2'
    const catId = 'c-2'
    const itemId = 'i-2'
    await t.db.insert(restaurant).values({
      id: restaurantId,
      organizationId: orgId,
      name: 'Sem traduções',
      slug: 'sem-traducoes',
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      description: 'Tasca em Lisboa',
      // No EN description translation.
      descriptionI18n: null,
    })
    await t.db.insert(menu).values({
      id: menuId,
      restaurantId,
      name: 'Carta',
      position: 0,
    })
    await t.db.insert(category).values({
      id: catId,
      menuId,
      restaurantId,
      name: 'Pratos',
      // No translations at all.
      nameI18n: null,
      description: null,
      descriptionI18n: null,
      position: 0,
    })
    await t.db.insert(item).values({
      id: itemId,
      categoryId: catId,
      restaurantId,
      name: 'Bacalhau',
      // No name translation; description never existed; one variant
      // has an EN translation, one does NOT.
      nameI18n: null,
      description: null,
      descriptionI18n: null,
      priceCents: 1200,
      variants: [
        { label: 'Dose', labelI18n: { en: 'Full' }, priceCents: 1200 },
        { label: 'Meia dose', priceCents: 700 },
      ] satisfies ItemVariant[],
      position: 0,
    })

    const stats = await writer.updateLanguageSettings(restaurantId, {
      defaultLanguage: 'en',
      supportedLanguages: ['pt', 'en'],
    })

    expect(stats.defaultChanged).toBe(true)
    // Only one variant label was promotable.
    expect(stats.rowsPromoted).toBe(1)
    // restaurant.description (content, no translation) + category.name
    // (content, no translation) + item.name (content, no translation) +
    // 1 variant label = 4 surfaces with content but no translation.
    // Description-only nulls don't count.
    expect(stats.rowsNeedingAttention).toBe(4)

    // Item: untranslated rows kept their PT source; the one variant
    // with a translation got promoted; the other variant kept its PT.
    const [it] = await t.db
      .select()
      .from(item)
      .where(eq(item.id, itemId))
      .limit(1)
    expect(it?.name).toBe('Bacalhau')
    expect(it?.variants).toEqual([
      { label: 'Full', labelI18n: { pt: 'Dose' }, priceCents: 1200 },
      { label: 'Meia dose', labelI18n: null, priceCents: 700 },
    ])
  })

  it('only rewrites rows for the requested restaurant (tenant isolation)', async () => {
    const { restaurantId: r1 } = await seedRestaurantWithTranslations()
    // Seed a second restaurant in the same DB with its own translatable
    // rows; its data MUST be untouched by an updateLanguageSettings
    // call on r1.
    const r2 = 'r-other'
    const c2 = 'c-other'
    const it2 = 'i-other'
    await t.db.insert(restaurant).values({
      id: r2,
      organizationId: 'o-other',
      name: 'Outra casa',
      slug: 'outra',
      defaultLanguage: 'pt',
      supportedLanguages: ['pt', 'en'],
      description: 'Other description',
      descriptionI18n: { en: 'Other description (EN)' } as LocalizedText,
    })
    await t.db.insert(menu).values({
      id: 'm-other',
      restaurantId: r2,
      name: 'm',
      position: 0,
    })
    await t.db.insert(category).values({
      id: c2,
      menuId: 'm-other',
      restaurantId: r2,
      name: 'Cat',
      nameI18n: { en: 'Cat EN' } as LocalizedText,
      position: 0,
    })
    await t.db.insert(item).values({
      id: it2,
      categoryId: c2,
      restaurantId: r2,
      name: 'Other item',
      nameI18n: { en: 'Other item EN' } as LocalizedText,
      priceCents: 100,
      variants: [
        { label: 'A', labelI18n: { en: 'A-en' }, priceCents: 100 },
      ] satisfies ItemVariant[],
      position: 0,
    })

    await writer.updateLanguageSettings(r1, {
      defaultLanguage: 'en',
      supportedLanguages: ['pt', 'en'],
    })

    // r2's translatable rows are byte-for-byte unchanged.
    const [other] = await t.db
      .select()
      .from(restaurant)
      .where(eq(restaurant.id, r2))
      .limit(1)
    expect(other?.defaultLanguage).toBe('pt')
    expect(other?.description).toBe('Other description')
    const [otherCat] = await t.db
      .select()
      .from(category)
      .where(eq(category.id, c2))
      .limit(1)
    expect(otherCat?.name).toBe('Cat')
    const [otherItem] = await t.db
      .select()
      .from(item)
      .where(eq(item.id, it2))
      .limit(1)
    expect(otherItem?.name).toBe('Other item')
    expect(otherItem?.variants).toEqual([
      { label: 'A', labelI18n: { en: 'A-en' }, priceCents: 100 },
    ])
  })
})
