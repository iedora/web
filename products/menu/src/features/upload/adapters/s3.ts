import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { SpanStatusCode } from '@opentelemetry/api'
import { meter, tracer, IEDORA_RESTAURANT_ID, IEDORA_ORGANIZATION_ID } from '@iedora/observability'
import {
  StorageError,
  type PresignedUpload,
  type PresignedUploadRequest,
  type StoredObject,
  type Storage,
} from '../types'

/**
 * Per-operation latency histogram for outbound S3 (R2/MinIO) calls.
 * User-facing operations: presign on upload-start, head on commit,
 * delete on clear. The fetch instrumentation already emits a span for
 * each underlying HTTPS call; this histogram surfaces them grouped by
 * logical operation so dashboards can SLO each independently.
 */
const storageOpDuration = meter.createHistogram(
  'iedora.storage.operation_duration_ms',
  {
    description:
      'Latency of S3-compatible storage operations (presign-put | head | delete).',
    unit: 'ms',
  },
)

/**
 * Outcome counter — `success` / `not-found` (404 from head/delete) /
 * `failed` (any other StorageError). Tracks "are we getting 4xx/5xx from
 * R2" without parsing trace exceptions.
 */
const storageOps = meter.createCounter('iedora.storage.operations_total', {
  description:
    'Outbound storage operations, grouped by operation name and outcome.',
  unit: 'call',
})

type StorageOp = 'presign-put' | 'head' | 'delete'
type StorageOutcome = 'success' | 'not-found' | 'failed'

async function tracedStorageOp<T>(
  op: StorageOp,
  key: string,
  fn: () => Promise<{ value: T; outcome: StorageOutcome }>,
): Promise<T> {
  return tracer.startActiveSpan(`storage.${op}`, async (span) => {
    span.setAttribute('iedora.storage.operation', op)
    // Key is `r/{restaurantId}/...` (asset hard rule #9). The restaurant
    // segment is the tenant attribution; recording it here also lets
    // dashboards filter storage spans by tenant even when the operation
    // is called outside a tenantContext.run block (e.g. bootstrap).
    const restaurantSegment = key.match(/^r\/([^/]+)\//)?.[1]
    if (restaurantSegment) {
      span.setAttribute(IEDORA_RESTAURANT_ID, restaurantSegment)
    }
    span.setAttribute('iedora.storage.key', key)
    const startedAt = performance.now()
    let outcome: StorageOutcome = 'failed'
    try {
      const { value, outcome: o } = await fn()
      outcome = o
      span.setAttribute('iedora.storage.outcome', outcome)
      if (outcome === 'failed') {
        span.setStatus({ code: SpanStatusCode.ERROR })
      }
      return value
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      const labels = {
        'iedora.storage.operation': op,
        'iedora.storage.outcome': outcome,
      }
      storageOpDuration.record(performance.now() - startedAt, labels)
      storageOps.add(1, labels)
      span.end()
    }
  })
}

export type S3StorageConfig = {
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
  // Where the bucket is publicly served. For path-style MinIO this is
  // `${endpoint}/${bucket}`. For a CDN (R2/Cloudfront) it can be a custom domain.
  publicBaseUrl: string
  // MinIO requires path-style; AWS S3 supports both but defaults to virtual-hosted.
  forcePathStyle?: boolean
}

const DEFAULT_EXPIRES = 60 * 5 // 5 minutes

export class S3Storage implements Storage {
  private readonly client: S3Client

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    })
  }

  async presignPut(
    key: string,
    req: PresignedUploadRequest,
  ): Promise<PresignedUpload> {
    return tracedStorageOp('presign-put', key, async () => {
      try {
        const cmd = new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: req.contentType,
          ContentLength: req.contentLengthBytes,
        })
        const uploadUrl = await getSignedUrl(this.client, cmd, {
          expiresIn: DEFAULT_EXPIRES,
          // Browser PUT must send Content-Length and Content-Type, so they are
          // signed in. Do not strip them when calling fetch from the client.
          signableHeaders: new Set(['content-type', 'content-length']),
        })
        const publicUrl = `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`
        return {
          value: {
            uploadUrl,
            publicUrl,
            key,
            expiresInSeconds: DEFAULT_EXPIRES,
          } satisfies PresignedUpload,
          outcome: 'success',
        }
      } catch (cause) {
        throw new StorageError('Failed to presign upload', cause)
      }
    })
  }

  async head(key: string): Promise<StoredObject | null> {
    return tracedStorageOp('head', key, async () => {
      try {
        const res = await this.client.send(
          new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
        )
        return {
          value: {
            contentLength:
              typeof res.ContentLength === 'number' ? res.ContentLength : 0,
            contentType: res.ContentType,
          } satisfies StoredObject,
          outcome: 'success',
        }
      } catch (cause) {
        // 404 → object isn't there yet (client never completed PUT, or the
        // presigned URL leaked but was never used). Bubble anything else.
        if (isNotFound(cause)) {
          return { value: null as StoredObject | null, outcome: 'not-found' }
        }
        throw new StorageError('Failed to head object', cause)
      }
    })
  }

  keyFromPublicUrl(url: string): string | null {
    const prefix = this.config.publicBaseUrl.replace(/\/$/, '') + '/'
    return url.startsWith(prefix) ? url.slice(prefix.length) : null
  }

  async delete(key: string): Promise<void> {
    return tracedStorageOp('delete', key, async () => {
      try {
        await this.client.send(
          new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
        )
        return { value: undefined as void, outcome: 'success' }
      } catch (cause) {
        // Deletes are best-effort: a missing key shouldn't fail the calling action.
        // Real errors still bubble so callers can log/monitor.
        if (isNoSuchKey(cause)) {
          return { value: undefined as void, outcome: 'not-found' }
        }
        throw new StorageError('Failed to delete object', cause)
      }
    })
  }

  // Used by bootstrap.ts only — keeps the SDK access scoped to this module.
  rawClient(): S3Client {
    return this.client
  }
}

function isNoSuchKey(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'name' in err && err.name === 'NoSuchKey',
  )
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? err.name : undefined
  const status =
    '$metadata' in err && err.$metadata && typeof err.$metadata === 'object'
      ? (err.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404
}
