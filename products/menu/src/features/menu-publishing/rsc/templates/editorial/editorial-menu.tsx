import type { RenderProps } from '../../types'
import { formatPrice } from '../../format'

/**
 * Editorial template — "manuscrito de chef".
 *
 * Aesthetic: print-magazine + 1970s cookbook. Manuscript margins where
 * each category gets a roman numeral in the left gutter; the body reads
 * like prose, not a price list. Hairline rules, italic serif, drop caps.
 * No icons. No badges. No dotted leaders — names and prices separated by
 * a thin em-dash.
 *
 * Tone is intentionally restrained — `primaryColor` shows up only in the
 * roman numerals and the masthead rule. Most of the page is ink-on-paper.
 */

const ROMAN_NUMERALS = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
] as const

function toRoman(n: number): string {
  if (n < ROMAN_NUMERALS.length) return ROMAN_NUMERALS[n] ?? String(n)
  // Fallback for menus with >20 categories — extremely rare. Decimal is fine.
  return String(n)
}

export function EditorialMenu({ restaurant: r, menus }: RenderProps) {
  const totalItems = menus.reduce(
    (sum, m) => sum + m.categories.reduce((s, c) => s + c.items.length, 0),
    0,
  )

  return (
    <main className="mx-auto max-w-3xl px-8 pb-24 pt-12 sm:px-12 sm:pt-20">
      <header className="mb-12 grid grid-cols-1 items-end gap-3 lg:grid-cols-[1fr_minmax(0,14rem)] lg:gap-12">
        <h1 className="text-balance text-5xl italic leading-[0.95] tracking-tight sm:text-6xl">
          {r.name}
        </h1>
        {r.description && (
          <p
            className="text-pretty text-xs uppercase leading-relaxed tracking-[0.2em] lg:text-right"
            style={{ color: 'var(--menu-secondary)' }}
          >
            {r.description}
          </p>
        )}
      </header>

      <div
        className="mb-16 h-px w-full"
        style={{ background: 'var(--menu-primary)' }}
      />

      {totalItems === 0 ? (
        <p
          className="text-center text-sm italic"
          style={{ color: 'var(--menu-secondary)' }}
        >
          — em preparação —
        </p>
      ) : (
        menus.map((m, mi) => (
          <div key={m.id}>
            {menus.length > 1 && (
              <h2 className="mb-10 mt-4 text-center text-sm uppercase tracking-[0.4em]">
                {m.name}
              </h2>
            )}
            {m.categories.length === 0 ? (
              <p
                className="text-center text-sm italic"
                style={{ color: 'var(--menu-secondary)' }}
              >
                — em preparação —
              </p>
            ) : (
              m.categories.map((c, ci) => (
                <section
                  key={c.id}
                  aria-labelledby={`cat-${c.id}`}
                  className="mb-16 grid grid-cols-[3rem_1fr] items-baseline gap-6 sm:grid-cols-[5rem_1fr] sm:gap-10"
                >
                  <aside className="text-right">
                    <span
                      className="text-3xl italic leading-none sm:text-4xl"
                      style={{ color: 'var(--menu-primary)' }}
                      aria-hidden="true"
                    >
                      {toRoman(ci + 1)}
                    </span>
                  </aside>
                  <div>
                    <h3
                      id={`cat-${c.id}`}
                      className="mb-5 text-2xl italic leading-tight"
                    >
                      {c.name}
                    </h3>
                    {c.description && (
                      <p
                        className="mb-6 text-sm leading-relaxed first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-5xl first-letter:italic first-letter:leading-none"
                        style={{ color: 'var(--menu-secondary)' }}
                      >
                        {c.description}
                      </p>
                    )}
                    {c.items.length === 0 ? (
                      <p
                        className="text-sm italic"
                        style={{ color: 'var(--menu-secondary)' }}
                      >
                        — em preparação —
                      </p>
                    ) : (
                      <ul className="space-y-5">
                        {c.items.map((it) => {
                          const variants = it.variants ?? []
                          return (
                            <li key={it.id}>
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-base font-medium">
                                  {it.name}
                                </span>
                                {variants.length === 0 && (
                                  <>
                                    <span
                                      aria-hidden
                                      className="text-sm opacity-40"
                                    >
                                      —
                                    </span>
                                    <span className="text-sm italic tabular-nums">
                                      {formatPrice(it.priceCents, it.currency)}
                                    </span>
                                  </>
                                )}
                              </div>
                              {it.description && (
                                <p
                                  className="mt-1 text-sm italic leading-snug"
                                  style={{ color: 'var(--menu-secondary)' }}
                                >
                                  {it.description}
                                </p>
                              )}
                              {it.tags.length > 0 && (
                                <p
                                  className="mt-1 text-xs italic"
                                  style={{ color: 'var(--menu-secondary)' }}
                                >
                                  {it.tags.join(', ')}
                                </p>
                              )}
                              {variants.length > 0 && (
                                <dl className="mt-2 space-y-1">
                                  {variants.map((v, vi) => (
                                    <div
                                      key={`${v.label}-${vi}`}
                                      className="flex items-baseline gap-3 text-sm"
                                    >
                                      <dt
                                        className="italic"
                                        style={{
                                          color: 'var(--menu-secondary)',
                                        }}
                                      >
                                        {v.label}
                                      </dt>
                                      <dd
                                        aria-hidden
                                        className="flex-1 opacity-30"
                                      >
                                        ·
                                      </dd>
                                      <dd className="italic tabular-nums">
                                        {formatPrice(v.priceCents, it.currency)}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </section>
              ))
            )}
            {mi < menus.length - 1 && (
              <div
                className="mx-auto my-12 h-px w-12"
                style={{ background: 'var(--menu-primary)' }}
                aria-hidden="true"
              />
            )}
          </div>
        ))
      )}
    </main>
  )
}
