'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@iedora/design-system'

/**
 * Cross-platform photo capture. Same component is used on phone, tablet,
 * and desktop — no device-specific branches. We ask `getUserMedia` for
 * `{ facingMode: { ideal: 'environment' } }` so phones land on the rear
 * camera and laptops fall back to whatever webcam they have.
 *
 * Two visible states:
 *   - `live`    : video stream + Capture button
 *   - `preview` : freeze-frame `<img>` + Retake / Use this photo
 *
 * Lifecycle:
 *   - mount: request the stream; surface a clear error if the user denies
 *     or the device has no camera (operator can still hit Cancel and
 *     reach the upload-from-device path)
 *   - unmount / leaving the live state: stop every track so the browser
 *     drops the recording indicator
 *
 * Output is a `File` (JPEG, quality 0.92) handed to `onCapture`; the
 * wizard treats it exactly like an uploaded file.
 */
export function CameraCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (file: File) => void
  onCancel: () => void
}) {
  const t = useTranslations('Restaurant')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<'starting' | 'live' | 'preview' | 'error'>(
    'starting',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [snapshotFile, setSnapshotFile] = useState<File | null>(null)

  function stopStream() {
    const stream = streamRef.current
    if (!stream) return
    for (const track of stream.getTracks()) track.stop()
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  // Start (and re-start, on Retake) the camera stream whenever we're in
  // the `live`-intent states. `getUserMedia` is the same API on desktop
  // webcams and mobile cameras — `facingMode: { ideal: 'environment' }`
  // is a hint, not a hard constraint, so machines without a rear camera
  // fall back to the only camera they have instead of failing.
  useEffect(() => {
    if (status !== 'starting') return
    let cancelled = false

    async function start() {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        if (cancelled) return
        setStatus('error')
        setErrorMessage(t('importMenuCameraUnavailable'))
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setStatus('live')
      } catch (err) {
        if (cancelled) return
        const denied =
          err && typeof err === 'object' && 'name' in err
            ? err.name === 'NotAllowedError' ||
              err.name === 'PermissionDeniedError'
            : false
        setStatus('error')
        setErrorMessage(
          denied
            ? t('importMenuCameraDenied')
            : t('importMenuCameraUnavailable'),
        )
      }
    }

    start()

    return () => {
      cancelled = true
    }
  }, [status, t])

  // Always tear down the stream on unmount. `useEffect` cleanup guarantees
  // this runs even when the parent suddenly swaps the step out from under us.
  useEffect(() => stopStream, [])

  // Revoke object URLs we minted for the snapshot preview so we don't leak.
  useEffect(() => {
    if (!snapshotUrl) return
    return () => URL.revokeObjectURL(snapshotUrl)
  }, [snapshotUrl])

  function capture() {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    const width = video.videoWidth
    const height = video.videoHeight
    if (width === 0 || height === 0) return

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, width, height)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `menu-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })
        setSnapshotFile(file)
        setSnapshotUrl(URL.createObjectURL(blob))
        setStatus('preview')
        stopStream()
      },
      'image/jpeg',
      0.92,
    )
  }

  function retake() {
    setSnapshotFile(null)
    setSnapshotUrl(null)
    setStatus('starting')
  }

  function use() {
    if (!snapshotFile) return
    onCapture(snapshotFile)
  }

  function cancel() {
    stopStream()
    onCancel()
  }

  return (
    <div className="space-y-3" data-test-id="menu-import-camera">
      <div className="relative overflow-hidden rounded-xl border border-[var(--ink-14)] bg-black">
        {status === 'preview' && snapshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={snapshotUrl}
            alt=""
            className="block w-full"
            data-test-id="menu-import-camera-snapshot"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="block w-full"
            data-test-id="menu-import-camera-video"
          />
        )}

        {status === 'starting' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--paper)]/80 text-sm">
            {t('importMenuCameraStarting')}
          </div>
        )}
      </div>

      {status === 'error' && errorMessage && (
        <p
          className="text-sm text-[var(--cinnabar)]"
          role="alert"
          data-test-id="menu-import-camera-error"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={cancel}
          data-test-id="menu-import-camera-cancel"
        >
          {t('importMenuCameraCancel')}
        </Button>

        {status === 'preview' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={retake}
              data-test-id="menu-import-camera-retake"
            >
              {t('importMenuCameraRetake')}
            </Button>
            <Button
              type="button"
              variant="solid"
              onClick={use}
              data-test-id="menu-import-camera-use"
            >
              {t('importMenuCameraUseThis')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="solid"
            onClick={capture}
            disabled={status !== 'live'}
            data-test-id="menu-import-camera-capture"
          >
            {t('importMenuCameraCapture')}
          </Button>
        )}
      </div>
    </div>
  )
}
