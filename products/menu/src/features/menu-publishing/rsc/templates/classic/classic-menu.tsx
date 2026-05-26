import Link from 'next/link'
import { BRAND_NAME, BRAND_URL } from '@iedora/brand'
import type { RenderProps } from '../../types'
import { formatPrice } from '../../format'

export function ClassicMenu({ restaurant: r, menus }: RenderProps) {
  const totalItems = menus.reduce(
    (sum, m) => sum + m.categories.reduce((s, c) => s + c.items.length, 0),
    0,
  )

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-10 sm:pt-16">
      <header className="mb-12 text-center">
        {r.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.logoUrl}
            alt={`${r.name} logo`}
            className="mx-auto mb-4 h-20 w-20 rounded-full object-cover"
          />
        )}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{r.name}</h1>
        {r.description && (
          <p
            className="mx-auto mt-3 max-w-md text-balance text-sm"
            style={{ color: 'var(--menu-secondary)' }}
          >
            {r.description}
          </p>
        )}
      </header>

      {totalItems === 0 ? (
        <p
          className="rounded-lg border border-dashed p-8 text-center text-sm"
          style={{ color: 'var(--menu-secondary)' }}
        >
          This menu is being prepared. Check back soon.
        </p>
      ) : (
        <div className="space-y-14">
          {menus.map((m) => (
            <section key={m.id} className="space-y-8" aria-labelledby={`menu-${m.id}`}>
              {menus.length > 1 && (
                <h2
                  id={`menu-${m.id}`}
                  className="border-b pb-2 text-xl font-semibold tracking-tight"
                >
                  {m.name}
                </h2>
              )}
              {m.categories.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--menu-secondary)' }}>
                  No categories yet.
                </p>
              ) : (
                m.categories.map((c) => (
                  <section key={c.id} className="space-y-4" aria-labelledby={`cat-${c.id}`}>
                    <header>
                      <h3
                        id={`cat-${c.id}`}
                        className="text-lg font-medium tracking-tight"
                      >
                        {c.name}
                      </h3>
                      {c.description && (
                        <p
                          className="mt-1 text-sm"
                          style={{ color: 'var(--menu-secondary)' }}
                        >
                          {c.description}
                        </p>
                      )}
                    </header>
                    {c.items.length === 0 ? (
                      <p className="text-sm" style={{ color: 'var(--menu-secondary)' }}>
                        No items.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {c.items.map((it) => {
                          const hasPhoto = Boolean(it.imageUrl)
                          return (
                            <li
                              key={it.id}
                              className={
                                'flex gap-4 py-3 ' +
                                (hasPhoto ? 'items-start ' : 'items-baseline ') +
                                (it.available ? '' : 'opacity-50')
                              }
                            >
                              {it.imageUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={it.imageUrl}
                                  alt=""
                                  className="h-14 w-14 shrink-0 rounded-md object-cover"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={
                                      'font-medium ' +
                                      (it.available ? '' : 'line-through')
                                    }
                                  >
                                    {it.name}
                                  </span>
                                  {!it.available && (
                                    <span
                                      className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase"
                                      style={{ color: 'var(--menu-secondary)' }}
                                    >
                                      Sold out
                                    </span>
                                  )}
                                </div>
                                {it.description && (
                                  <p
                                    className="mt-1 text-sm"
                                    style={{ color: 'var(--menu-secondary)' }}
                                  >
                                    {it.description}
                                  </p>
                                )}
                                {it.tags.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {it.tags.map((t) => (
                                      <span
                                        key={t}
                                        className="rounded-full border px-2 py-0.5 text-xs"
                                        style={{ color: 'var(--menu-secondary)' }}
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {(it.variants ?? []).length > 0 && (
                                  <dl className="mt-2 space-y-0.5">
                                    {(it.variants ?? []).map((v, vi) => (
                                      <div
                                        key={`${v.label}-${vi}`}
                                        className="flex items-baseline gap-2 text-sm"
                                        style={{ color: 'var(--menu-secondary)' }}
                                      >
                                        <dt>{v.label}</dt>
                                        <dd
                                          aria-hidden
                                          className="flex-1 translate-y-[-3px] border-b border-dotted"
                                          style={{ borderColor: 'var(--menu-secondary)' }}
                                        />
                                        <dd className="tabular-nums">
                                          {formatPrice(v.priceCents, it.currency)}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                              </div>
                              <span
                                className={
                                  'shrink-0 text-sm font-medium tabular-nums ' +
                                  (hasPhoto ? 'pt-0.5' : '')
                                }
                              >
                                {formatPrice(it.priceCents, it.currency)}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                ))
              )}
            </section>
          ))}
        </div>
      )}

      <footer
        className="mt-20 border-t pt-6 text-center text-xs"
        style={{ color: 'var(--menu-secondary)' }}
      >
        Powered by Menu · an{' '}
        <Link
          href={BRAND_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit' }}
        >
          {BRAND_NAME}
        </Link>{' '}
        product
      </footer>
    </main>
  )
}
