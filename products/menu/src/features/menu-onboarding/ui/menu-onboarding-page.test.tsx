// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/i18n/messages/en.json'
import { MenuOnboardingPage } from './menu-onboarding-page'

// The wizard reaches the menu-import + upload server actions; stub them
// so jsdom never tries to import 'server-only'.
vi.mock('@/features/menu-import/actions', () => ({
  analyzeMenuImage: vi.fn(),
  importMenuFromParsed: vi.fn(),
}))
vi.mock('@/features/upload/actions', () => ({
  requestUploadUrl: vi.fn(),
  commitAsset: vi.fn(),
}))
// `useRouter` requires the Next app-router context, which static SSR
// rendering doesn't provide. Stub with a noop.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function renderWithIntl(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  )
}

describe('MenuOnboardingPage', () => {
  const props = { slug: 'tasca', restaurantId: 'r-1' } as const

  it('renders the editorial heading, subtitle, and the brand link', () => {
    const html = renderWithIntl(<MenuOnboardingPage {...props} />)
    expect(html).toContain('data-test-id="menu-onboarding-page"')
    expect(html).toContain('data-test-id="menu-onboarding-brand-link"')
    expect(html).toContain('data-test-id="menu-onboarding-title"')
    expect(html).toContain('data-test-id="menu-onboarding-subtitle"')
    expect(html).toContain('>Build your menu</h1>')
  })

  it('hosts the AI wizard at the upload step on first render with both camera and upload paths', () => {
    const html = renderWithIntl(<MenuOnboardingPage {...props} />)
    expect(html).toContain('data-test-id="menu-import-wizard-upload"')
    // Both options surface upfront — same UI on phone, tablet, and
    // desktop. The "Take a photo" button opens a `getUserMedia`
    // preview (see CameraCapture); the upload button opens the OS
    // file picker.
    expect(html).toContain('data-test-id="menu-import-take-photo"')
    expect(html).toContain('data-test-id="menu-import-upload-photo"')
    expect(html).not.toContain('data-test-id="menu-import-wizard-preview"')
    expect(html).not.toContain('data-test-id="menu-import-wizard-camera"')
  })

  it('exposes a Skip control inline next to the wizard', () => {
    const html = renderWithIntl(<MenuOnboardingPage {...props} />)
    expect(html).toContain('data-test-id="menu-onboarding-skip"')
    // React HTML-escapes the apostrophe in "I'll" → &#x27;; assert
    // against a stable substring of the i18n value instead of the raw
    // string so the test doesn't drift with copy tweaks that change
    // the punctuation.
    expect(html).toContain('Skip')
    expect(html).toContain('add dishes manually')
    expect(html).toContain('data-test-id="menu-onboarding-skip-hint"')
    expect(html).toContain(en.Onboarding.menu.skipHint)
  })
})
