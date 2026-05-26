// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClassicMenu } from './classic/classic-menu'
import { MinimalMenu } from './minimal/minimal-menu'
import type { RenderProps } from '../types'

vi.mock('server-only', () => ({}))

function makeProps(): RenderProps {
  return {
    restaurant: {
      id: 'r-1',
      name: 'Taberna do José',
      slug: 'taberna-do-jose',
      description: null,
      logoUrl: null,
      bannerUrl: null,
    },
    menus: [
      {
        id: 'm-1',
        name: 'Main',
        description: null,
        categories: [
          {
            id: 'c-1',
            name: 'Mains',
            description: null,
            items: [
              {
                id: 'it-1',
                name: 'Bacalhau à brás',
                description: null,
                priceCents: 1450,
                currency: 'EUR',
                available: true,
                tags: [],
                imageUrl: null,
                variants: [{ label: 'Meia dose', priceCents: 800 }],
              },
              {
                id: 'it-2',
                name: 'Café (Bica)',
                description: null,
                priceCents: 100,
                currency: 'EUR',
                available: true,
                tags: [],
                imageUrl: null,
                variants: [],
              },
            ],
          },
        ],
      },
    ],
    theme: {
      layout: 'classic',
      font: 'inter',
      primary: '#000',
      secondary: '#666',
    },
  } as unknown as RenderProps
}

describe('ClassicMenu · variants', () => {
  it('renders the variant label and price for items that have variants', () => {
    const html = renderToStaticMarkup(<ClassicMenu {...makeProps()} />)
    expect(html).toContain('Meia dose')
    // Half-dose price formatted; we tolerate either € symbol position.
    expect(html).toMatch(/€\s*8\.00|8\.00\s*€/)
    // Primary price still present.
    expect(html).toMatch(/€\s*14\.50|14\.50\s*€/)
  })

  it('omits the variant block entirely for items with no variants', () => {
    const props = makeProps()
    // Drop the Bacalhau item — leaves only Café (no variants).
    props.menus[0]!.categories[0]!.items = [
      props.menus[0]!.categories[0]!.items[1]!,
    ]
    const html = renderToStaticMarkup(<ClassicMenu {...props} />)
    expect(html).not.toContain('Meia dose')
  })
})

describe('MinimalMenu · variants', () => {
  it('renders the variant label and price indented under the item', () => {
    const html = renderToStaticMarkup(<MinimalMenu {...makeProps()} />)
    expect(html).toContain('Meia dose')
    expect(html).toMatch(/€\s*8\.00|8\.00\s*€/)
    expect(html).toMatch(/€\s*14\.50|14\.50\s*€/)
  })

  it('omits the variant block entirely for items with no variants', () => {
    const props = makeProps()
    props.menus[0]!.categories[0]!.items = [
      props.menus[0]!.categories[0]!.items[1]!,
    ]
    const html = renderToStaticMarkup(<MinimalMenu {...props} />)
    expect(html).not.toContain('Meia dose')
  })
})

describe('Stale snapshots (no `variants` field at all)', () => {
  // Regression: `unstable_cache` entries written before the schema bump
  // are missing the field. Cache-key was bumped to v2 to flush them,
  // but both templates also have a `it.variants ?? []` guard as a
  // second line of defence so a stale entry can't crash the page.
  function makeStaleProps(): RenderProps {
    const props = makeProps()
    for (const m of props.menus) {
      for (const c of m.categories) {
        for (const it of c.items) {
          // Simulate the pre-schema shape exactly: property absent.
          delete (it as Partial<typeof it>).variants
        }
      }
    }
    return props
  }

  it('ClassicMenu renders without crashing when an item is missing `variants`', () => {
    expect(() =>
      renderToStaticMarkup(<ClassicMenu {...makeStaleProps()} />),
    ).not.toThrow()
  })

  it('MinimalMenu renders without crashing when an item is missing `variants`', () => {
    expect(() =>
      renderToStaticMarkup(<MinimalMenu {...makeStaleProps()} />),
    ).not.toThrow()
  })
})
