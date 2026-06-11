'use client'

import * as React from 'react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Field,
  FieldInput,
  FieldLabel,
  FieldHint,
} from '@iedora/design-system'
import {
  A4_H_MM,
  A4_W_MM,
  DEFAULT_GUTTER_MM,
  DEFAULT_PAGE_MARGIN_MM,
  DEFAULT_QR_MM,
  MAX_GUTTER_MM,
  MAX_PAGE_MARGIN_MM,
  MAX_QR_MM,
  MIN_GUTTER_MM,
  MIN_PAGE_MARGIN_MM,
  MIN_QR_MM,
  autoFitQrSize,
  clampLayoutInputs,
  computeGrid,
  type PrintGrid,
} from './print-layout'

export function QrPrintSheetDialog({
  open,
  onOpenChange,
  code,
  stickerUrl,
  label,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  code: string
  stickerUrl: string
  label: string | null
}) {
  const [qrSizeInput, setQrSizeInput] = useState<number>(DEFAULT_QR_MM)
  const [gutterInput, setGutterInput] = useState<number>(DEFAULT_GUTTER_MM)
  const [pageMarginInput, setPageMarginInput] = useState<number>(DEFAULT_PAGE_MARGIN_MM)
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  // Hydration gate for the print-sheet portal: false during SSR and
  // the hydration render, true on the client ever after. The
  // useSyncExternalStore form expresses this without a setState-in-
  // effect cascade (the store never changes; only the server/client
  // snapshots differ).
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  // margin: 0 — the print sheet's gutter supplies the QR's quiet zone.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    QRCode.toString(stickerUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((markup) => {
        if (!cancelled) setSvgMarkup(markup)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [stickerUrl, open])

  const inputs = useMemo(
    () =>
      clampLayoutInputs({
        qrSizeMm: qrSizeInput,
        gutterMm: gutterInput,
        pageMarginMm: pageMarginInput,
      }),
    [qrSizeInput, gutterInput, pageMarginInput],
  )
  const grid = useMemo(() => computeGrid(inputs), [inputs])

  // Use the current QR size as the floor so Auto-fit never shrinks
  // below what the user has already accepted as scannable.
  const handleAutoFit = () => {
    const fit = autoFitQrSize({
      minQrSizeMm: inputs.qrSizeMm,
      gutterMm: inputs.gutterMm,
      pageMarginMm: inputs.pageMarginMm,
    })
    setQrSizeInput(fit.qrSizeMm)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="break-all">Print A4 sheet · {code}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div
              className="grid gap-3 sm:grid-cols-3"
              data-test-id="qr-print-sheet-controls"
            >
              <Field>
                <FieldLabel htmlFor="qr-print-size">QR size (mm)</FieldLabel>
                <FieldInput
                  id="qr-print-size"
                  data-test-id="qr-print-sheet-size"
                  type="number"
                  compact
                  min={MIN_QR_MM}
                  max={MAX_QR_MM}
                  step={1}
                  value={qrSizeInput}
                  onChange={(e) => setQrSizeInput(Number(e.target.value))}
                />
                <FieldHint>≥ {MIN_QR_MM} mm for table-distance scans.</FieldHint>
              </Field>
              <Field>
                <FieldLabel htmlFor="qr-print-gutter">Cut gutter (mm)</FieldLabel>
                <FieldInput
                  id="qr-print-gutter"
                  data-test-id="qr-print-sheet-gutter"
                  type="number"
                  compact
                  min={MIN_GUTTER_MM}
                  max={MAX_GUTTER_MM}
                  step={1}
                  value={gutterInput}
                  onChange={(e) => setGutterInput(Number(e.target.value))}
                />
                <FieldHint>
                  Between codes. Doubles as the QR quiet zone.
                </FieldHint>
              </Field>
              <Field>
                <FieldLabel htmlFor="qr-print-margin">Page margin (mm)</FieldLabel>
                <FieldInput
                  id="qr-print-margin"
                  data-test-id="qr-print-sheet-margin"
                  type="number"
                  compact
                  min={MIN_PAGE_MARGIN_MM}
                  max={MAX_PAGE_MARGIN_MM}
                  step={1}
                  value={pageMarginInput}
                  onChange={(e) => setPageMarginInput(Number(e.target.value))}
                />
                <FieldHint>Printer-safe outer band — not cut.</FieldHint>
              </Field>
            </div>

            <PrintSheetSummary
              grid={grid}
              onAutoFit={handleAutoFit}
              autoFitDisabled={!svgMarkup}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              variant="solid"
              type="button"
              arrow
              disabled={!svgMarkup || grid.total === 0}
              onClick={() => window.print()}
              data-test-id="qr-print-sheet-print"
            >
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mounted &&
        open &&
        createPortal(
          <PrintSheet
            svgMarkup={svgMarkup}
            qrSizeMm={inputs.qrSizeMm}
            gutterMm={inputs.gutterMm}
            pageMarginMm={inputs.pageMarginMm}
            grid={grid}
            code={code}
            label={label}
          />,
          document.body,
        )}
    </>
  )
}

function PrintSheetSummary({
  grid,
  onAutoFit,
  autoFitDisabled,
}: {
  grid: PrintGrid
  onAutoFit: () => void
  autoFitDisabled: boolean
}) {
  const cm2PerCode = grid.mmPerCode / 100
  return (
    <div
      className="mt-4 flex flex-col gap-2 border border-[var(--ink-14)] bg-[var(--paper)] p-3 sm:flex-row sm:items-center sm:justify-between"
      data-test-id="qr-print-sheet-summary"
    >
      <div>
        <p className="font-[family-name:var(--mono)] text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-55)]">
          A4 · 210 × 297 mm
        </p>
        <p className="mt-1 text-sm text-[var(--ink)]">
          {grid.cols} × {grid.rows} ={' '}
          <strong data-test-id="qr-print-sheet-total">{grid.total}</strong> QR code
          {grid.total === 1 ? '' : 's'} per sheet
        </p>
        {grid.total > 0 && (
          <p
            className="mt-0.5 text-[11px] text-[var(--ink-55)]"
            data-test-id="qr-print-sheet-per-code"
          >
            ≈ {cm2PerCode.toFixed(1)} cm² of paper per sticker
          </p>
        )}
        {grid.total === 0 && (
          <p className="mt-1 text-xs text-[var(--cinnabar)]">
            Reduce QR size or gutter — nothing fits at these values.
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        onClick={onAutoFit}
        disabled={autoFitDisabled}
        data-test-id="qr-print-sheet-autofit"
      >
        Auto-fit
      </Button>
    </div>
  )
}

// Hidden on screen; materializes only inside the @print stylesheet.
// Sized in mm so the printer driver matches the physical A4 sheet.
function PrintSheet({
  svgMarkup,
  qrSizeMm,
  gutterMm,
  pageMarginMm,
  grid,
  code,
  label,
}: {
  svgMarkup: string | null
  qrSizeMm: number
  gutterMm: number
  pageMarginMm: number
  grid: PrintGrid
  code: string
  label: string | null
}) {
  const cells = svgMarkup && grid.total > 0 ? grid.total : 0
  return (
    <div id="qr-print-sheet-root" aria-hidden="true">
      <style>{`
        #qr-print-sheet-root { position: fixed; inset: 0; visibility: hidden; pointer-events: none; z-index: -1; }
        #qr-print-sheet-root svg { width: 100%; height: 100%; display: block; }
        @media print {
          @page { size: A4; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body > *:not(#qr-print-sheet-root) { display: none !important; }
          #qr-print-sheet-root { position: static; visibility: visible; pointer-events: auto; z-index: auto; }
        }
      `}</style>
      <div
        id="qr-print-sheet"
        data-test-id="qr-print-sheet"
        data-qr-code={code}
        data-qr-label={label ?? ''}
        style={{
          width: `${A4_W_MM}mm`,
          height: `${A4_H_MM}mm`,
          padding: `${pageMarginMm}mm`,
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(grid.cols, 1)}, ${qrSizeMm}mm)`,
          gridAutoRows: `${qrSizeMm}mm`,
          gap: `${gutterMm}mm`,
          justifyContent: 'start',
          alignContent: 'start',
          background: '#fff',
        }}
      >
        {Array.from({ length: cells }).map((_, i) => (
          <div
            key={i}
            style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }}
            dangerouslySetInnerHTML={{ __html: svgMarkup as string }}
          />
        ))}
      </div>
    </div>
  )
}

// Inert subscription for the hydration gate above — the value never
// changes after mount, so there is nothing to subscribe to.
function emptySubscribe() {
  return () => {}
}
