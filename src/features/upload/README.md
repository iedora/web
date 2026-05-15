# upload slice

Presigned PUT to S3-compatible storage. LocalStack in dev/CI, R2/S3 in prod.

## Public API

- `@/features/upload` — `Storage` type, `getStorage()` factory, `ensureBucket()` bootstrap
- `@/features/upload/actions` — `requestUploadUrl`, `commitAsset`, `clearAsset` server actions
- `@/features/upload/ui/image-upload` — `<ImageUpload target=...>` client component

## Port + adapters

`Storage` (in `./types.ts`) is the port. Implementations:
- `./adapters/s3.ts` — AWS SDK v3 against any S3-compatible endpoint
- `./adapters/factory.ts` — env-driven singleton (`getStorage()`)
- `./adapters/bootstrap.ts` — idempotent bucket creation + public-read policy + CORS (LocalStack)

## Why this exists

AGENTS.md hard rule #9: every uploaded object's S3 key starts with
`r/{restaurantId}/`. `requireRestaurantAccess` runs first
(`./actions.ts`); `assertKeyBelongsToTarget` validates the key inside
the use-case as defense-in-depth.
