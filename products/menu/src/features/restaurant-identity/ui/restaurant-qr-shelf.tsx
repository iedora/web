'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useTranslations } from 'next-intl'
import { Badge, Button, SectionHeader } from '@iedora/design-system'
import { QrViewer } from './qr-viewer'

/**
 * Per-restaurant QR shelf — the read-only tenant-side view of every QR
 * pointing at this restaurant. Two stacked sections:
 *
 *   1. **Your menu QR** — `/r/<slug>`, the QR most operators want for
 *      menus, business cards, social. Owned by them; freely
 *      regeneratable from the slug.
 *
 *   2. **Bound stickers** — `/q/<code>`, pre-printed sticker codes
 *      assigned to this restaurant cross-tenant by the iedora team via
 *      `/dashboard/admin/qr-codes`. Tagged `Admin-managed` so the
 *      operator immediately understands the section is read-only and
 *      who to contact to change it.
 *
 * Both sections share the same `SectionHeader` rhythm; both are
 * single-column on mobile and gain columns from `sm` upward. The
 * branded card is centred via a grid place so the QR doesn't drift
 * to the left edge on wider viewports.
 */
export function RestaurantQrShelf({
  brandedUrl,
  restaurantName,
  stickers,
  publicOrigin,
}: {
  brandedUrl: string
  restaurantName: string
  /** Sticker codes bound to this restaurant. Empty list = nothing to render below the branded QR. */
  stickers: ReadonlyArray<{
    code: string
    label: string | null
    boundAt: string | null
  }>
  publicOrigin: string
}) {
  const t = useTranslations('Qr')

  return (
    <div
      className="space-y-10"
      data-test-id="restaurant-qr-shelf"
    >
      <section className="space-y-4" data-test-id="restaurant-qr-branded-section">
        <SectionHeader title={t('brandedTitle')} hint={t('brandedHint')} />
        <div className="grid place-items-center">
          <QrViewer
            publicUrl={brandedUrl}
            restaurantName={restaurantName}
          />
        </div>
      </section>

      {stickers.length > 0 && (
        <section
          className="space-y-4"
          data-test-id="restaurant-qr-bound-section"
        >
          {/* Heading row: title fills the row, the admin-managed badge
              clings to the right. flex-wrap so on a narrow phone the
              badge drops below the title instead of cramping it. */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <SectionHeader
                title={t('boundStickersTitle', { count: stickers.length })}
                hint={t('boundStickersCount', { count: stickers.length })}
              />
            </div>
            <Badge
              variant="ghost"
              data-test-id="restaurant-qr-bound-admin-tag"
            >
              {t('adminManagedTag')}
            </Badge>
          </div>

          <p
            className="max-w-prose text-sm text-[var(--ink-55)]"
            data-test-id="restaurant-qr-bound-explanation"
          >
            {t('boundStickersExplanation')}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stickers.map((s) => (
              <StickerCard
                key={s.code}
                code={s.code}
                label={s.label}
                stickerUrl={`${publicOrigin}/q/${s.code}`}
                restaurantName={restaurantName}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

const COMPACT_PX = 160
const PNG_EXPORT_PX = 1024

function StickerCard({
  code,
  label,
  stickerUrl,
  restaurantName,
}: {
  code: string
  label: string | null
  stickerUrl: string
  restaurantName: string
}) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Qr')

  useEffect(() => {
    let cancelled = false
    QRCode.toString(stickerUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((markup) => {
        if (!cancelled) setSvgMarkup(markup)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [stickerUrl])

  async function downloadPng() {
    try {
      const dataUrl = await QRCode.toDataURL(stickerUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: PNG_EXPORT_PX,
        color: { dark: '#000000', light: '#ffffff' },
      })
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      triggerDownload(blob, fileBaseName(restaurantName, code) + '.png')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <article
      className="flex flex-col gap-3 border border-[var(--ink-14)] bg-[var(--paper)] p-3"
      data-test-id="qr-sticker-card"
    >
      <div
        className="mx-auto bg-white p-2"
        style={{ width: COMPACT_PX + 16, height: COMPACT_PX + 16 }}
      >
        {svgMarkup ? (
          <div
            style={{ width: COMPACT_PX, height: COMPACT_PX }}
            className="[&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <div
            style={{ width: COMPACT_PX, height: COMPACT_PX }}
            className="animate-pulse bg-[var(--ink-14)]"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
          {t('stickerCodeLabel')} · {code}
        </span>
        {label && (
          <span className="truncate text-sm text-[var(--ink)]" title={label}>
            {label}
          </span>
        )}
        <span
          className="truncate font-mono text-[10px] text-[var(--ink-40)]"
          title={stickerUrl}
        >
          {stickerUrl.replace(/^https?:\/\//, '')}
        </span>
      </div>
      {error && <p className="text-[10px] text-[var(--cinnabar)]">{error}</p>}
      <Button
        type="button"
        variant="ghost"
        onClick={downloadPng}
        disabled={!svgMarkup}
        data-test-id="qr-sticker-download"
        className="w-full"
      >
        {t('downloadPng')}
      </Button>
    </article>
  )
}

function fileBaseName(restaurantName: string, code: string): string {
  const slug = restaurantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${slug || 'restaurant'}-${code}`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
