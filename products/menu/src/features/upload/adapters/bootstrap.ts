import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3'
import { env } from '@/shared/env'
import type { S3Storage } from './s3'

let bootstrapped = false

// Anonymous read scoped to `r/*` (tenant-prefixed keys built by `buildKey` in
// features/upload/targets.ts). Anything written outside that prefix — orphan
// debris, manual uploads, future internal buckets — is NOT world-readable.
// Writes always go through presigned PUT so they remain auth'd.
function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/r/*`],
      },
    ],
  })
}

// Idempotent. Safe to call from multiple actions concurrently — only the first
// caller pays the network cost; the rest see `bootstrapped === true` and skip.
//
// Skip entirely for Cloudflare R2: bucket + CORS + public-access custom
// domain are all declaratively managed by infra/iac/tofu/. PutBucketPolicy is
// also unsupported on R2 (public access is via the custom-domain binding,
// not a bucket policy), so trying to apply this would error.
export async function ensureBucket(storage: S3Storage, bucket: string): Promise<void> {
  if (bootstrapped) return
  if (isR2Endpoint(storage)) {
    bootstrapped = true
    return
  }
  const client = storage.rawClient()

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (err) {
    if (!isNotFound(err)) throw err
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  }

  // Re-applying the policy is cheap and self-heals if it was wiped manually.
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: publicReadPolicy(bucket),
    }),
  )

  // CORS is split into two rules:
  //   - GET stays open to any origin so public menu pages (and mobile webviews
  //     with `Origin: null`) can render <img src> without a preflight gate.
  //   - PUT/HEAD only allow the app's origin to initiate (presigned signature
  //     still gates the actual write, but this blocks a third-party page from
  //     instructing a victim's browser to consume a leaked presign URL).
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3000,
          },
          {
            AllowedOrigins: [env.MENU_PUBLIC_URL],
            AllowedMethods: ['PUT', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  )

  bootstrapped = true
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? err.name : undefined
  const status =
    '$metadata' in err && err.$metadata && typeof err.$metadata === 'object'
      ? (err.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined
  return name === 'NotFound' || name === 'NoSuchBucket' || status === 404
}

function isR2Endpoint(storage: S3Storage): boolean {
  // We can't read the config back from the SDK client cleanly across versions,
  // so peek at the env var the factory passed through. Cheap + matches the
  // detection in factory.ts.
  return /r2\.cloudflarestorage\.com/.test(process.env.S3_ENDPOINT ?? '')
}
