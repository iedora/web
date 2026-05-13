'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useTranslations } from 'next-intl'
import { Button } from '@/shared/ui/button'

// Render size in CSS pixels for the on-screen preview. PNG export uses a
// higher pixel multiplier so prints stay sharp.
const PREVIEW_PX = 320
const PNG_EXPORT_PX = 1024

export function QrViewer({
  publicUrl,
  restaurantName,
}: {
  publicUrl: string
  restaurantName: string
}) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printRef = useRef<HTMLDivElement>(null)
  const t = useTranslations('Qr')

  useEffect(() => {
    let cancelled = false
    QRCode.toString(publicUrl, {
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
  }, [publicUrl])

  function downloadSvg() {
    if (!svgMarkup) return
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml' })
    triggerDownload(blob, fileBaseName(restaurantName) + '.svg')
  }

  async function downloadPng() {
    try {
      const dataUrl = await QRCode.toDataURL(publicUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: PNG_EXPORT_PX,
        color: { dark: '#000000', light: '#ffffff' },
      })
      // toDataURL returns base64; convert to a Blob so the download lands as
      // an actual binary file rather than a navigated data URI.
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      triggerDownload(blob, fileBaseName(restaurantName) + '.png')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function printQr() {
    window.print()
  }

  return (
    <div className="space-y-6">
      <div
        ref={printRef}
        data-testid="qr-printable"
        className="qr-printable mx-auto flex w-fit flex-col items-center gap-4 rounded-lg border bg-white p-6"
      >
        {svgMarkup ? (
          <div
            data-testid="qr-svg"
            style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
            className="[&>svg]:h-full [&>svg]:w-full"
            // qrcode.toString returns trusted, deterministic SVG markup.
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <div
            style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
            className="animate-pulse rounded bg-muted"
          />
        )}
        <div className="text-center">
          <p className="text-base font-semibold">{restaurantName}</p>
          <p className="text-xs text-muted-foreground">{t('scan')}</p>
        </div>
      </div>

      {error && (
        <p data-testid="qr-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 print:hidden">
        <Button
          type="button"
          variant="outline"
          onClick={downloadSvg}
          disabled={!svgMarkup}
          data-testid="qr-download-svg"
        >
          {t('downloadSvg')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={downloadPng}
          disabled={!svgMarkup}
          data-testid="qr-download-png"
        >
          {t('downloadPng')}
        </Button>
        <Button type="button" onClick={printQr} data-testid="qr-print">
          {t('print')}
        </Button>
      </div>

      <style>{`
        @media print {
          /* Strip every chrome that isn't the QR card so the printer ink
             goes to the code itself. The .qr-printable card is centered on
             its own page. */
          body * { visibility: hidden !important; }
          .qr-printable, .qr-printable * { visibility: visible !important; }
          .qr-printable { position: fixed; inset: 0; margin: auto; border: none !important; }
        }
      `}</style>
    </div>
  )
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

function fileBaseName(restaurantName: string): string {
  return (
    'menu-qr-' +
      restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'menu-qr'
  )
}
