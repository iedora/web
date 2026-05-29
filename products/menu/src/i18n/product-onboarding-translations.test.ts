import { describe, expect, it } from 'vitest'
import {
  PRODUCTS,
  PRODUCT_ONBOARDING_STATUS_LIST,
  type ProductId,
} from '@iedora/brand'
import en from './messages/en.json'

/**
 * Contract: every product id + every onboarding status MUST have a
 * translation under `Core.admin.tenants.detail.products.{label|status}`
 * in en.json. The admin tenant detail page renders these generically;
 * a missing entry leaks the raw key path into the UI.
 */

type Messages = Record<string, unknown>

function get(obj: Messages, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Messages)[key]
          : undefined,
      obj,
    )
}

const products = (en as Messages).Core
  ? ((en as { Core: { admin: { tenants: { detail: { products: Messages } } } } })
      .Core.admin.tenants.detail.products as Messages)
  : ({} as Messages)

const PRODUCT_IDS = Object.values(PRODUCTS) as ReadonlyArray<ProductId>

describe('product onboarding i18n catalogue (en.json)', () => {
  it.each(PRODUCT_IDS.map((p) => [p] as const))(
    'has a label for product %s',
    (product) => {
      const value = get(products, `label.${product}`)
      expect(typeof value, `missing label.${product}`).toBe('string')
    },
  )

  it.each(PRODUCT_ONBOARDING_STATUS_LIST.map((s) => [s] as const))(
    'has a label for status %s',
    (status) => {
      const value = get(products, `status.${status}`)
      expect(typeof value, `missing status.${status}`).toBe('string')
    },
  )
})
