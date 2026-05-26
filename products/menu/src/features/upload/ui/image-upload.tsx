'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@iedora/design-system'
import { commitAsset, clearAsset, requestUploadUrl } from '../actions'
import { TARGET_CONSTRAINTS } from '../targets'
import type { AssetTarget } from '../types'

export function ImageUpload({
  target,
  currentUrl,
  label,
  onChange,
}: {
  target: AssetTarget
  currentUrl: string | null
  label: string
  onChange: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const constraints = TARGET_CONSTRAINTS[target.kind]
  const acceptAttr = constraints.acceptedMimeTypes.join(',')
  const maxMb = (constraints.maxBytes / (1024 * 1024)).toFixed(0)

  function validate(file: File): string | null {
    if (!constraints.acceptedMimeTypes.includes(file.type as never)) {
      return `Unsupported file type. Use ${constraints.acceptedMimeTypes.join(', ')}.`
    }
    if (file.size > constraints.maxBytes) {
      return `File too large. Max ${maxMb} MB.`
    }
    return null
  }

  function onPick(file: File) {
    setError(null)
    const v = validate(file)
    if (v) {
      setError(v)
      return
    }

    startTransition(async () => {
      const presign = await requestUploadUrl({
        target,
        contentType: file.type,
        contentLengthBytes: file.size,
      })
      if (!presign.ok) {
        setError(presign.error)
        return
      }

      const put = await fetch(presign.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!put.ok) {
        setError(`Upload failed (${put.status})`)
        return
      }

      const commit = await commitAsset({
        target,
        key: presign.data.key,
        publicUrl: presign.data.publicUrl,
      })
      if (!commit.ok) {
        setError(commit.error)
        return
      }

      onChange(commit.data.url)
    })
  }

  function onRemove() {
    setError(null)
    startTransition(async () => {
      const result = await clearAsset({ target })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onChange(null)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={`${label} preview`}
            data-testid={`upload-${target.kind}-preview`}
            className="h-16 w-16 rounded-md border object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            none
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={acceptAttr}
            data-testid={`upload-${target.kind}-input`}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPick(f)
              // Reset so the same file can be picked again after a remove.
              e.target.value = ''
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
              data-testid={`upload-${target.kind}-pick`}
            >
              {pending ? 'Uploading…' : currentUrl ? 'Replace' : 'Upload'}
            </Button>
            {currentUrl && (
              <Button
                type="button"
                variant="ghost"
                onClick={onRemove}
                disabled={pending}
                data-testid={`upload-${target.kind}-remove`}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {constraints.recommended
              ? `Recommended ${constraints.recommended.width}×${constraints.recommended.height} (${constraints.recommended.aspectLabel}). `
              : ''}
            Max {maxMb} MB. JPG, PNG, or WebP.
          </p>
          {error && (
            <p
              className="text-xs text-destructive"
              data-testid={`upload-${target.kind}-error`}
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
