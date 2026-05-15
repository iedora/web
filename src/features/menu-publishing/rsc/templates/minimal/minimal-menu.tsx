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
                      {c.items.map((it) => (
                        <li
                          key={it.id}
                          className={
                            'flex items-baseline gap-2 ' +
                            (it.available ? '' : 'opacity-50')
                          }
                        >
                          <span
                            className={
                              'font-normal ' + (it.available ? '' : 'line-through')
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
                        </li>
                      ))}
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
