// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DashboardPage } from './dashboard-page'

describe('DashboardPage', () => {
  it('renders title as a plain <h1> when no intermediate crumbs are passed', () => {
    const html = renderToStaticMarkup(
      <DashboardPage title="Menus" data-test-id="dashboard-root">
        <div>content</div>
      </DashboardPage>,
    )
    expect(html).toMatch(/<h1[^>]*class="ds-breadcrumb__here"/)
    expect(html).toContain('data-test-id="dashboard-root-heading"')
    expect(html).toContain('>Menus</h1>')
    expect(html).not.toContain('aria-label="Breadcrumb"')
  })

  it('drops the redundant Home trail on flat pages — sidebar is the back-affordance now', () => {
    const html = renderToStaticMarkup(
      <DashboardPage title="Billing" data-test-id="billing">
        <div />
      </DashboardPage>,
    )
    // No breadcrumb chrome — the sidebar already says we're on Billing.
    expect(html).not.toContain('aria-label="Breadcrumb"')
    expect(html).not.toContain('data-test-id="billing-breadcrumbs"')
    // h1 with heading test-id and the title text.
    expect(html).toContain('data-test-id="billing-heading"')
    expect(html).toContain('>Billing</h1>')
  })

  it('renders the breadcrumb trail when at least one intermediate crumb is supplied', () => {
    const html = renderToStaticMarkup(
      <DashboardPage
        title="QR Code"
        data-test-id="qr"
        crumbs={[
          { label: 'Tasca do Avô', href: '/dashboard/r/tasca', testId: 'restaurant' },
        ]}
      >
        <div />
      </DashboardPage>,
    )
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('data-test-id="qr-breadcrumbs"')
    expect(html).toContain('data-test-id="qr-breadcrumb-restaurant"')
    expect(html).toContain('href="/dashboard/r/tasca"')
    expect(html).toContain('>Tasca do Avô</a>')
    expect(html).toContain('data-test-id="qr-breadcrumb-current"')
    expect(html).toContain('>QR Code</h1>')
  })

  it('falls back to index when a crumb has no testId', () => {
    const html = renderToStaticMarkup(
      <DashboardPage
        title="X"
        data-test-id="x"
        crumbs={[
          { label: 'A', href: '/a' },
          { label: 'B', href: '/b' },
        ]}
      >
        {null}
      </DashboardPage>,
    )
    expect(html).toContain('data-test-id="x-breadcrumb-0"')
    expect(html).toContain('data-test-id="x-breadcrumb-1"')
  })

  it('renders eyebrow + description + actions in the header row only when supplied', () => {
    const html = renderToStaticMarkup(
      <DashboardPage
        title="Analytics"
        data-test-id="analytics"
        eyebrow="this month"
        description="A quiet measure of the room."
        actions={<button data-test-id="analytics-range">7d</button>}
      >
        <div />
      </DashboardPage>,
    )
    expect(html).toContain('data-test-id="analytics-header"')
    expect(html).toContain('data-test-id="analytics-eyebrow"')
    expect(html).toContain('data-test-id="analytics-description"')
    expect(html).toContain('data-test-id="analytics-actions"')
    expect(html).toContain('>this month</div>')
    expect(html).toContain('A quiet measure of the room.')
    expect(html).toContain('data-test-id="analytics-range"')
  })

  it('omits the header row entirely when no eyebrow/description/actions are supplied', () => {
    const html = renderToStaticMarkup(
      <DashboardPage title="X" data-test-id="x">
        <div />
      </DashboardPage>,
    )
    expect(html).not.toContain('data-test-id="x-header"')
  })

  it('forwards data-test-id to the outer wrapper', () => {
    const html = renderToStaticMarkup(
      <DashboardPage title="X" data-test-id="my-page">
        <div />
      </DashboardPage>,
    )
    expect(html).toMatch(/^<div[^>]*data-test-id="my-page"/)
  })

  it('chrome="none" hides the header entirely and keeps an sr-only h1', () => {
    const html = renderToStaticMarkup(
      <DashboardPage title="Menu de exemplo" data-test-id="menu-builder" chrome="none">
        <div data-test-id="menu-builder-body">content</div>
      </DashboardPage>,
    )
    // The h1 still exists for a11y/SEO, but visually hidden.
    expect(html).toMatch(/<h1[^>]*class="sr-only"[^>]*>Menu de exemplo<\/h1>/)
    expect(html).toContain('data-test-id="menu-builder-heading"')
    // No breadcrumb, no header row, no eyebrow/description/actions slot.
    expect(html).not.toContain('aria-label="Breadcrumb"')
    expect(html).not.toContain('data-test-id="menu-builder-header"')
    expect(html).not.toContain('class="ds-breadcrumb__here"')
    // The body still renders.
    expect(html).toContain('data-test-id="menu-builder-body"')
    // Outer wrapper uses the tight 12px rhythm — not the chunky 24px
    // of standard chrome.
    expect(html).toContain('class="space-y-3"')
    expect(html).not.toContain('class="space-y-6"')
  })

  it('applies the standard spacing rhythm', () => {
    // No horizontal rule — the page heading + sidebar context are enough.
    // The space-y rhythm carries the visual structure on its own.
    const html = renderToStaticMarkup(
      <DashboardPage title="X">
        <div />
      </DashboardPage>,
    )
    expect(html).toContain('class="space-y-6"')
    expect(html).not.toContain('class="ds-separator"')
  })
})
