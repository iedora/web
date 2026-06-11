import type { PublicItem, RenderProps } from '../../types'
import { formatPrice } from '../../format'

/**
 * Cards template — "menu visual, photo-led".
 *
 * Aesthetic: contemporary food-app (Square, Toast). Hero banner with the
 * brand on top, sticky horizontal category chips with scroll-snap, items
 * as rounded cards. Items without an `imageUrl` get a deterministic
 * primaryColor gradient so menus without photos still look intentional.
 *
 * Compound shadows over single shadows (cheap depth, no border noise).
 * Mobile-first single column; tablet+ goes to a 2-column grid.
 */

export function CardsMenu({ restaurant: r, menus }: RenderProps) {
  const totalItems = menus.reduce(
    (sum, m) => sum + m.categories.reduce((s, c) => s + c.items.length, 0),
    0,
  )
  // Flatten the category list for the sticky nav. With multiple menus we
  // prefix the menu name so the chip is unambiguous.
  const navCategories = menus.flatMap((m) =>
    m.categories.map((c) => ({
      id: c.id,
      label: menus.length > 1 ? `${m.name} · ${c.name}` : c.name,
    })),
  )

  return (
    <div className="bg-[#fafaf7] pb-16">
      <header
        className="relative h-56 overflow-hidden sm:h-72"
        style={{ background: 'var(--menu-primary)' }}
      >
        {r.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.bannerUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-5 text-white sm:gap-4 sm:p-8">
          {r.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.logoUrl}
              alt={`${r.name} logo`}
              className="h-16 w-16 shrink-0 rounded-2xl border-2 border-white object-cover shadow-lg sm:h-20 sm:w-20"
              loading="eager"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              {r.name}
            </h1>
            {r.description && (
              <p className="mt-1 line-clamp-2 text-sm text-white/85 sm:text-base">
                {r.description}
              </p>
            )}
          </div>
        </div>
      </header>

      {totalItems === 0 ? (
        <p className="px-4 pt-12 text-center text-sm text-neutral-500">
          Este menu está a ser preparado. Volta em breve.
        </p>
      ) : (
        <>
          {navCategories.length > 1 && (
            <nav
              aria-label="Categorias"
              className="sticky top-0 z-10 flex gap-2 overflow-x-auto bg-[#fafaf7]/90 px-4 py-3 backdrop-blur sm:px-6"
              style={{ scrollbarWidth: 'none' }}
            >
              {navCategories.map((c) => (
                <a
                  key={c.id}
                  href={`#cat-${c.id}`}
                  className="shrink-0 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_-2px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_-8px_rgba(0,0,0,0.12)]"
                >
                  {c.label}
                </a>
              ))}
            </nav>
          )}

          <main className="space-y-12 px-4 pt-6 sm:px-6">
            {menus.map((m) => (
              <div key={m.id}>
                {menus.length > 1 && (
                  <h2 className="mb-6 text-2xl font-bold tracking-tight text-neutral-900">
                    {m.name}
                  </h2>
                )}
                {m.categories.length === 0 ? (
                  <EmptyCard>Em breve novidades neste menu.</EmptyCard>
                ) : (
                  m.categories.map((c) => (
                    <section
                      key={c.id}
                      id={`cat-${c.id}`}
                      className="scroll-mt-20 pt-6 first:pt-0"
                      aria-labelledby={`heading-${c.id}`}
                    >
                      <h2
                        id={`heading-${c.id}`}
                        className="mb-4 text-2xl font-bold tracking-tight text-neutral-900"
                      >
                        {c.name}
                      </h2>
                      {c.description && (
                        <p className="mb-4 text-sm text-neutral-600">
                          {c.description}
                        </p>
                      )}
                      {c.items.length === 0 ? (
                        <EmptyCard>Em breve novidades nesta secção.</EmptyCard>
                      ) : (
                        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          {c.items.map((it) => (
                            <ItemCard key={it.id} item={it} />
                          ))}
                        </ul>
                      )}
                    </section>
                  ))
                )}
              </div>
            ))}
          </main>
        </>
      )}
    </div>
  )
}

function ItemCard({ item: it }: { item: PublicItem }) {
  const variants = it.variants ?? []
  return (
    <li
      className="group overflow-hidden rounded-3xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_8px_24px_-8px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(0,0,0,0.15)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {it.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={it.imageUrl}
            alt={it.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <PlaceholderGradient seed={it.name} />
        )}
        {it.tags.length > 0 && (
          <div className="absolute left-3 top-3 flex flex-wrap gap-1">
            {it.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-medium text-neutral-800 backdrop-blur"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-snug text-neutral-900">
            {it.name}
          </h3>
          {variants.length === 0 && (
            <span
              className="shrink-0 text-base font-bold tabular-nums"
              style={{ color: 'var(--menu-primary)' }}
            >
              {formatPrice(it.priceCents, it.currency)}
            </span>
          )}
        </div>
        {it.description && (
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
            {it.description}
          </p>
        )}
        {variants.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {variants.map((v, vi) => (
              <div
                key={`${v.label}-${vi}`}
                className="rounded-2xl border border-black/10 px-3 py-1.5"
              >
                <div className="text-xs text-neutral-600">{v.label}</div>
                <div
                  className="text-sm font-bold tabular-nums"
                  style={{ color: 'var(--menu-primary)' }}
                >
                  {formatPrice(v.priceCents, it.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-black/10 p-12 text-center">
      <p className="text-sm text-neutral-500">{children}</p>
    </div>
  )
}

/**
 * Deterministic gradient placeholder. Same item name always produces the
 * same gradient angle, so revisits look stable. Hue is derived from
 * primaryColor (via `color-mix`) so the placeholder reads as part of the
 * brand, not an empty slot.
 */
function PlaceholderGradient({ seed }: { seed: string }) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const angle = hash % 360
  return (
    <div
      aria-hidden="true"
      className="relative h-full w-full"
      style={{
        background: `linear-gradient(${angle}deg, color-mix(in oklab, var(--menu-primary) 28%, white) 0%, color-mix(in oklab, var(--menu-primary) 8%, white) 100%)`,
      }}
    >
      <div
        className="h-full w-full opacity-25"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '14px 14px',
          color: 'var(--menu-primary)',
        }}
      />
    </div>
  )
}
