'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useTranslations } from 'next-intl'
import { Button } from '@iedora/design-system'

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
    <div className="w-full max-w-md space-y-6">
      <div
        ref={printRef}
        data-test-id="qr-printable"
        className="qr-printable mx-auto flex w-fit flex-col items-center gap-4 border border-[var(--ink-14)] bg-white p-6"
      >
        {svgMarkup ? (
          <div
            data-test-id="qr-svg"
            style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
            className="[&>svg]:h-full [&>svg]:w-full"
            // qrcode.toString returns trusted, deterministic SVG markup.
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <div
            style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
            className="animate-pulse bg-[var(--ink-14)]"
          />
        )}
        <div className="space-y-1 text-center">
          <p className="font-[family-name:var(--serif)] text-base font-medium text-[var(--ink)]">
            {restaurantName}
          </p>
          <p className="font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
            {t('scan')}
          </p>
          {/* Fallback URL — printed alongside the QR so anyone who can't
              scan can still type the address. Protocol stripped to keep
              the line tight; full URL is the title for hover/copy. */}
          <p
            className="break-all font-mono text-[10px] text-[var(--ink-40)]"
            title={publicUrl}
            data-test-id="qr-public-url"
          >
            {publicUrl.replace(/^https?:\/\//, '')}
          </p>
        </div>
      </div>

      {error && (
        <p
          data-test-id="qr-error"
          className="text-sm text-[var(--cinnabar)]"
        >
          {error}
        </p>
      )}

      {/* Stack full-width on mobile so each button is a comfortable
          thumb target. From sm+ they sit in a centered inline row. */}
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center print:hidden">
        <Button
          type="button"
          onClick={downloadSvg}
          disabled={!svgMarkup}
          data-test-id="qr-download-svg"
          className="w-full sm:w-auto"
        >
          {t('downloadSvg')}
        </Button>
        <Button
          type="button"
          onClick={downloadPng}
          disabled={!svgMarkup}
          data-test-id="qr-download-png"
          className="w-full sm:w-auto"
        >
          {t('downloadPng')}
        </Button>
        <Button
          type="button"
          variant="solid"
          onClick={printQr}
          data-test-id="qr-print"
          className="w-full sm:w-auto"
        >
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
