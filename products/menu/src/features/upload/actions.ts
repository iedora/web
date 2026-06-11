'use server'

import { ApiError } from '@iedora/api-client'
import * as api from '../../shared/api'
import type { PresignedUpload } from '../../shared/api'
import type { AssetTarget } from './types'

/**
 * Server action shells over the Go menu service's upload endpoints.
 * Flow: presign (server) → browser PUTs the file straight to storage →
 * commit (server) persists the public URL on the restaurant / item.
 *
 * The Go service owns ALL authorization (Bearer token + slug scope),
 * key derivation, size/content-type limits, and the head-check on
 * commit — these only translate `ApiError` into the `{ ok, error }`
 * shape the `<ImageUpload>` component renders.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong'
}

function itemId(target: AssetTarget): string | undefined {
  return target.kind === 'item-photo' ? target.itemId : undefined
}

export async function requestUploadUrl(input: {
  target: AssetTarget
  contentType: string
}): Promise<Result<PresignedUpload>> {
  const { target, contentType } = input
  try {
    const data = await api.presignUpload(target.slug, target.kind, contentType, itemId(target))
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function commitAsset(input: {
  target: AssetTarget
  key: string
}): Promise<Result<{ url: string }>> {
  const { target, key } = input
  try {
    const data = await api.commitUpload(target.slug, target.kind, key, itemId(target))
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function clearAsset(input: {
  target: AssetTarget
}): Promise<Result<null>> {
  const { target } = input
  try {
    await api.clearUpload(target.slug, target.kind, itemId(target))
    return { ok: true, data: null }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}
