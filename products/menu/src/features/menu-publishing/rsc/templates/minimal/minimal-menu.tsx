import type { RenderProps } from '../../types'
import { formatPrice } from '../../format'

export function MinimalMenu({ restaurant: r, menus }: RenderProps) {
  const totalItems = menus.reduce(
    (sum, m) => sum + m.categories.reduce((s, c) => s + c.items.length, 0),
    0,
  )

  return (
    <main className="mx-auto max-w-xl px-6 pb-20 pt-12">
      <header className="mb-10">
        <h1 className="text-2xl font-medium uppercase tracking-[0.18em]">{r.name}</h1>
        {r.description && (
          <p className="mt-2 text-sm" style={{ color: 'var(--menu-secondary)' }}>
            {r.description}
          </p>
        )}
      </header>

      {totalItems === 0 ? (
        <p className="text-sm" style={{ color: 'var(--menu-secondary)' }}>
          This menu is being prepared.
        </p>
      ) : (
        <div className="space-y-10">
          {menus.map((m) => (
            <section key={m.id} className="space-y-6" aria-labelledby={`menu-${m.id}`}>
              {menus.length > 1 && (
                <h2
                  id={`menu-${m.id}`}
                  className="text-xs font-semibold uppercase tracking-[0.24em]"
                  style={{ color: 'var(--menu-secondary)' }}
                >
                  {m.name}
                </h2>
              )}
              {m.categories.map((c) => (
                <section key={c.id} className="space-y-3" aria-labelledby={`cat-${c.id}`}>
                  <h3
                    id={`cat-${c.id}`}
                    className="text-sm font-semibold uppercase tracking-[0.16em]"
                  >
                    {c.name}
                  </h3>
                  {c.items.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--menu-secondary)' }}>
                      No items.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {c.items.map((it) => {
                        // Defensive against stale cached snapshots that
                        // were serialised before the `variants` field
                        // existed. The cache-key was bumped to v2 to
                        // flush them; this guard is the second layer.
                        const variants = it.variants ?? []
                        return (
                        <li
                          key={it.id}
                          className={it.available ? '' : 'opacity-50'}
                        >
                          <div className="flex items-baseline gap-2">
                            <span
                              className={
                                'font-normal ' +
                                (it.available ? '' : 'line-through')
                              }
                            >
                              {it.name}
                            </span>
                            <span
                              aria-hidden
                              className="flex-1 translate-y-[-3px] border-b border-dotted"
                              style={{ borderColor: 'var(--menu-secondary)' }}
                            />
                            <span className="font-mono text-sm tabular-nums">
                              {formatPrice(it.priceCents, it.currency)}
                            </span>
                          </div>
                          {variants.length > 0 && (
                            <dl className="mt-1 space-y-0.5 pl-3">
                              {variants.map((v, vi) => (
                                <div
                                  key={`${v.label}-${vi}`}
                                  className="flex items-baseline gap-2 text-xs"
                                  style={{ color: 'var(--menu-secondary)' }}
                                >
                                  <dt>{v.label}</dt>
                                  <dd
                                    aria-hidden
                                    className="flex-1 translate-y-[-3px] border-b border-dotted"
                                    style={{ borderColor: 'var(--menu-secondary)' }}
                                  />
                                  <dd className="font-mono tabular-nums">
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
                </section>
              ))}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
