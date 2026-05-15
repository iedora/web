import 'server-only'
import { ensureBucket } from './bootstrap'
import { S3Storage } from './s3'
import type { Storage } from '../types'

function readEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

let instance: S3Storage | null = null
let bucket: string | null = null

function getInstance(): { storage: S3Storage; bucket: string } {
  if (instance && bucket) return { storage: instance, bucket }
  const endpoint = readEnv('S3_ENDPOINT')
  const region = readEnv('S3_REGION')
  bucket = readEnv('S3_BUCKET')
  const accessKey = readEnv('S3_ACCESS_KEY')
  const secretKey = readEnv('S3_SECRET_KEY')
  // Default public base assumes path-style addressing (MinIO). Override with
  // S3_PUBLIC_URL when fronting the bucket with a CDN/custom domain.
  const publicBaseUrl =
    process.env.S3_PUBLIC_URL ?? `${endpoint.replace(/\/$/, '')}/${bucket}`

  instance = new S3Storage({
    endpoint,
    region,
    bucket,
    accessKey,
    secretKey,
    publicBaseUrl,
    forcePathStyle: true,
  })
  return { storage: instance, bucket }
}

// Wraps `storage` calls with a one-time bootstrap. Server actions just call
// `await getStorage()` and forget about bucket lifecycle.
export async function getStorage(): Promise<Storage> {
  const { storage, bucket } = getInstance()
  await ensureBucket(storage, bucket)
  return storage
}
