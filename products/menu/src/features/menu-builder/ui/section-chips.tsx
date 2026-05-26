'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Sticky horizontal chip nav — top of the menu editor.
 *
 * Why: a typical Portuguese restaurant menu has 4–6 sections and 25–40
 * items. On a phone that's a 5–6 screen scroll. A chip nav cuts the
 * round-trip to one tap. The chips also serve as a visual table of
 * contents so the operator can see, at a glance, what's in the menu.
 *
 * Behaviour:
 *   - Tap a chip → smooth-scrolls the matching `#section-<id>` heading
 *     into view, offset so it lands below the sticky chip bar itself.
 *   - The chip whose section is currently most in-view is highlighted.
 *     Implemented with IntersectionObserver — no scroll listener, no
 *     RAF loop.
 *   - "+ Add section" is the last chip. Clicking it scrolls to the
 *     bottom and focuses the add-section CTA there (we don't render
 *     two CTAs).
 *
 * The bar slides under the dashboard header (which is also sticky in
 * the page chrome) so the eye lands on chips first when the operator
 * scrolls down past the title.
 */
export function SectionChips({
  categories,
  onAddSection,
  addLabel,
}: {
  categories: ReadonlyArray<{ id: string; name: string }>
  onAddSection: () => void
  addLabel: string
}) {
  const [activeId, setActiveId] = useState<string | null>(
    categories[0]?.id ?? null,
  )
  const scrollerRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())

  // IntersectionObserver highlights the section that occupies the most
  // of the viewport. `rootMargin` shifts the "centre line" up by 30%
  // so chips track scroll naturally (a section is "active" when its
  // top edge crosses the upper third).
  useEffect(() => {
    if (categories.length === 0) return
    const observed: Element[] = []
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the viewport top edge that is
        // intersecting. Falls back to whatever we last had.
        let bestId: string | null = null
        let bestTop = Number.POSITIVE_INFINITY
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const top = e.boundingClientRect.top
          if (top >= -40 && top < bestTop) {
            bestTop = top
            bestId = (e.target as HTMLElement).dataset.sectionId ?? null
          }
        }
        if (bestId) setActiveId(bestId)
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 1] },
    )
    for (const c of categories) {
      const el = document.querySelector(`[data-section-id="${c.id}"]`)
      if (el) {
        observer.observe(el)
        observed.push(el)
      }
    }
    return () => {
      for (const el of observed) observer.unobserve(el)
      observer.disconnect()
    }
  }, [categories])

  // When the active chip changes (by scroll OR by tap), keep it
  // horizontally visible inside the scroller. Without this the
  // operator could scroll past the active chip on mobile.
  useEffect(() => {
    if (!activeId) return
    const chip = chipRefs.current.get(activeId)
    const scroller = scrollerRef.current
    if (!chip || !scroller) return
    const chipBox = chip.getBoundingClientRect()
    const scrollerBox = scroller.getBoundingClientRect()
    if (chipBox.left < scrollerBox.left || chipBox.right > scrollerBox.right) {
      chip.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    }
  }, [activeId])

  function jumpToSection(id: string) {
    const el = document.querySelector<HTMLElement>(`[data-section-id="${id}"]`)
    if (!el) return
    // Offset by the sticky chip bar height so the section header
    // doesn't slide under the chips after the scroll lands.
    const offset = 96
    const top = el.getBoundingClientRect().top + window.scrollY - offset
    window.scrollTo({ top, behavior: 'smooth' })
    setActiveId(id)
  }

  return (
    <nav
      aria-label="Menu sections"
      data-test-id="menu-section-chips"
      className="menu-section-chips"
    >
      <div ref={scrollerRef} className="menu-section-chips__scroll">
        {categories.map((c) => {
          const active = c.id === activeId
          return (
            <button
              key={c.id}
              type="button"
              ref={(node) => {
                if (node) chipRefs.current.set(c.id, node)
                else chipRefs.current.delete(c.id)
              }}
              onClick={() => jumpToSection(c.id)}
              aria-current={active ? 'true' : undefined}
              data-active={active ? 'true' : 'false'}
              data-test-id={`menu-section-chip-${c.id}`}
              className="menu-section-chips__chip"
            >
              {c.name}
            </button>
          )
        })}
        <button
          type="button"
          onClick={onAddSection}
          data-test-id="menu-section-chip-add"
          className="menu-section-chips__chip menu-section-chips__chip--add"
        >
          {addLabel}
        </button>
      </div>
    </nav>
  )
}
