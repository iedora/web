import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  StorageError,
  type PresignedUpload,
  type PresignedUploadRequest,
  type Storage,
} from '../types'

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
        uploadUrl,
        publicUrl,
        key,
        expiresInSeconds: DEFAULT_EXPIRES,
      }
    } catch (cause) {
      throw new StorageError('Failed to presign upload', cause)
    }
  }

  keyFromPublicUrl(url: string): string | null {
    const prefix = this.config.publicBaseUrl.replace(/\/$/, '') + '/'
    return url.startsWith(prefix) ? url.slice(prefix.length) : null
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      )
    } catch (cause) {
      // Deletes are best-effort: a missing key shouldn't fail the calling action.
      // Real errors still bubble so callers can log/monitor.
      if (isNoSuchKey(cause)) return
      throw new StorageError('Failed to delete object', cause)
    }
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
