import 'server-only'
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

/**
 * Zero-domain S3 helpers against the LocalStack endpoint Playwright's
 * webServer starts. Knows only the bucket and credentials; has no
 * knowledge of asset-target conventions (`r/{restaurantId}/...`) or who
 * may upload what — that belongs in `@/features/upload/testing`.
 *
 * Use these to verify objects exist after the UI uploads (read-side
 * assertions) or to pre-place an object so a delete flow has something to
 * delete (fixture setup).
 */

const ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:4566'
const REGION = process.env.S3_REGION ?? 'us-east-1'
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'test'
const SECRET_KEY = process.env.S3_SECRET_KEY ?? 'test'
const BUCKET = process.env.S3_BUCKET ?? 'menu-test'

let _client: S3Client | null = null
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
      forcePathStyle: true,
    })
  }
  return _client
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType = 'application/octet-stream',
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export const STORAGE = { endpoint: ENDPOINT, region: REGION, bucket: BUCKET } as const
