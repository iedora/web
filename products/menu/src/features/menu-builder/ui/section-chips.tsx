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
  // When the operator taps a chip, we kick off a smooth-scroll AND
  // optimistically pin the highlight on the tapped section. The scroll
  // handler must not fight back during the animation — at any frame
  // the page is somewhere between the previous and the target section,
  // so a naive "topmost crossed" calculation would re-elect the
  // previous section and the chip would visibly flicker back. We hold
  // a lock on the target id until the section's header actually lands
  // near the chip-bar offset (or a hard timeout fires, in case the
  // user interrupts the scroll).
  const lockedTargetRef = useRef<string | null>(null)
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Scroll-driven highlight. We tried IntersectionObserver here first;
  // it broke on scroll UP because a section whose `top` was far above
  // the viewport (large negative) never re-activated — observer-based
  // "topmost intersecting" filters always biased toward sections
  // entering from below.
  //
  // The robust rule, mobile-first: the active section is the one whose
  // header has most recently crossed the sticky chip bar going down,
  // i.e. the section with the largest `top` value that is still ≤ the
  // chip-bar offset. Same logic up and down — read the DOM, pick a
  // winner, done. rAF coalesces scroll bursts so it stays cheap on
  // low-end Android.
  useEffect(() => {
    if (categories.length === 0) return

    let raf = 0
    function update() {
      raf = 0
      // Offset = sticky chip bar height + a hair of breathing room.
      // Falls back to the same 96 px constant used by `jumpToSection`
      // when the scroller ref isn't mounted yet (first paint).
      const offset = (scrollerRef.current?.getBoundingClientRect().bottom ?? 96) + 8

      // Tap-locked: keep the highlight pinned to the tap target until
      // its header sits within ~16 px of the offset line, then release.
      // The release-on-arrival check (instead of a pure timer) keeps
      // the chip honest even if the browser interrupts the smooth
      // scroll (eg. user touches the page mid-animation).
      const locked = lockedTargetRef.current
      if (locked) {
        const el = document.querySelector<HTMLElement>(
          `[data-section-id="${locked}"]`,
        )
        if (el) {
          const top = el.getBoundingClientRect().top
          if (Math.abs(top - offset) < 16) {
            lockedTargetRef.current = null
            if (lockTimeoutRef.current) {
              clearTimeout(lockTimeoutRef.current)
              lockTimeoutRef.current = null
            }
          } else {
            setActiveId(locked)
            return
          }
        } else {
          // Section vanished (deleted mid-scroll) — drop the lock.
          lockedTargetRef.current = null
        }
      }

      let bestId: string | null = categories[0]?.id ?? null
      let bestTop = Number.NEGATIVE_INFINITY
      for (const c of categories) {
        const el = document.querySelector<HTMLElement>(
          `[data-section-id="${c.id}"]`,
        )
        if (!el) continue
        const top = el.getBoundingClientRect().top
        // Pick the section whose header is the *last one* to have
        // crossed the chip bar going downward — that's the section
        // the user is currently reading, regardless of scroll
        // direction. Sections still below the bar are skipped.
        if (top <= offset && top > bestTop) {
          bestTop = top
          bestId = c.id
        }
      }
      if (bestId) setActiveId(bestId)
    }

    function onScroll() {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
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
    const offset = (scrollerRef.current?.getBoundingClientRect().bottom ?? 96) + 8
    const top = el.getBoundingClientRect().top + window.scrollY - offset
    // Pin the highlight to the tapped chip for the duration of the
    // smooth scroll. The scroll handler releases the lock once the
    // section header lands at the offset line; this timer is the
    // safety net for scrolls that never reach (eg. target near page
    // bottom — `scrollTo` clamps and the arrival check never fires).
    lockedTargetRef.current = id
    if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current)
    lockTimeoutRef.current = setTimeout(() => {
      lockedTargetRef.current = null
      lockTimeoutRef.current = null
    }, 1200)
    setActiveId(id)
    window.scrollTo({ top, behavior: 'smooth' })
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
