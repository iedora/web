# @iedora/observability

One-call OpenTelemetry wiring for every iedora product. Wraps
[`@vercel/otel`](https://www.npmjs.com/package/@vercel/otel) with the
resource attributes, sampling, and noise filters that match the iedora
fleet conventions so adding product N+1 = one line in its
`instrumentation.ts`.

## Surface

```ts
import {
  registerIedoraOtel,
  tracer,
  withTenantSpan,
  IEDORA_RESTAURANT_ID,
} from "@iedora/observability";
```

| Export                 | Use                                                                            |
| ---------------------- | ------------------------------------------------------------------------------ |
| `registerIedoraOtel`   | Called once from the product's `instrumentation.ts::register()`.               |
| `tracer`               | Pre-configured `Tracer` instance for custom spans.                             |
| `meter`                | Pre-configured `Meter` instance for counters / histograms / gauges.            |
| `withTenantSpan`       | Wrap a request-scoped operation in a span tagged with `tenant.restaurant_id`.  |
| `tenantAttributes`     | Build the canonical tenant-attribute record for metric `.add` / `.record` calls. |
| `IEDORA_RESTAURANT_ID` / `IEDORA_ORGANIZATION_ID` | Stable attribute-key constants for dashboards. |

## Quickstart

```ts
// products/<your-product>/instrumentation.ts
import { registerIedoraOtel } from "@iedora/observability";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  registerIedoraOtel({ serviceName: "iedora-yourproduct" });
  // ... your other startup work (DB drain, cron, etc.) goes after
}
```

That's the full integration. Tenant-scoped spans inside a route:

```ts
import { withTenantSpan } from "@iedora/observability";

export async function loadPublicMenu(slug: string) {
  return withTenantSpan(
    "load-public-menu",
    { restaurantId: restaurant.id, organizationId: restaurant.orgId },
    async () => loadRestaurantSnapshot(slug),
  );
}
```

Tenant-scoped counters / histograms:

```ts
import { meter, tenantAttributes } from "@iedora/observability";

const viewsCounter = meter.createCounter("iedora.restaurant_views_total", {
  description: "Newly tracked public-menu views (deduped per visitor/restaurant/hour)",
});

// Inside the beacon handler — fire one increment per real visit:
viewsCounter.add(1, {
  ...tenantAttributes({ restaurantId, organizationId }),
  "iedora.language": language,
});
```

The counter is safe to create at module load even before
`registerIedoraOtel` has run — the no-op meter degrades cleanly.

## Behaviour

### Resource attributes (per process)

| Key                              | Source                                              |
| -------------------------------- | --------------------------------------------------- |
| `service.namespace`              | `iedora` (constant)                                 |
| `service.name`                   | `opts.serviceName`                                  |
| `service.version`                | `process.env.GIT_SHA` (CI passes on build)          |
| `deployment.environment.name`    | `process.env.DEPLOYMENT_ENV` ?? `NODE_ENV`          |
| `host.name`                      | `process.env.HOST_NAME` (Tofu injects per fleet.tf) |

These match the iedora fleet manifest one-to-one — see issue #8 for the
manifest → resource-attribute derivation.

### Tenant attributes (per span)

Tenancy lives on **spans**, not resources. One Node process serves N
restaurants; `restaurant.id` on a resource would be wrong (resources are
per-process). Always use `withTenantSpan` (or set the constants manually)
when the work is scoped to one tenant.

### Sampling

| Environment   | Root sampler                            | Parent honoured? |
| ------------- | --------------------------------------- | ---------------- |
| `production`  | `TraceIdRatioBasedSampler(0.1)` (10%)   | Yes              |
| anything else | `AlwaysOnSampler` (100%)                | Yes              |

Both wrap a `NoiseFilteringSampler` that drops `GET /up` (Caddy + uptime
health checks) and `GET /api/track/*` (public-menu view beacon) before
any decision is made.

### Metrics export

When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, `registerIedoraOtel`
configures a `PeriodicExportingMetricReader` (60s interval by default)
that ships metrics via OTLP-HTTP to the same OpenObserve instance as
traces. The reader is not active when the endpoint is unset — the
package's `meter` still works (it's just no-op), so callers don't need
to gate their counter creation on register having run.

Tests inject their own reader via `registerIedoraOtel({ metricReaders })`
to pull samples synchronously (`InMemoryMetricExporter` + `forceFlush()`).
See `src/__tests__/metrics.test.ts` for the pattern.

### No-op in tests

`registerIedoraOtel` returns early when `NODE_ENV === "test"` so Vitest
suites (PGLite + `auth-testkit`) don't ship spans or contact the OTLP
collector. `tracer` and `withTenantSpan` are safe to call in tests —
they degrade to the no-op tracer from `@opentelemetry/api`.

## Cross-product trace context

`@vercel/otel`'s built-in W3C Trace Context propagator handles the
`traceparent` header on every outbound `fetch` automatically (so menu →
genkan identity-API calls stitch into one trace with no extra code).
Inbound propagation in Next 16 is automatic too.

For the webhook envelope (`@iedora/identity` sender → receiver), the
package's own `traceparent` header propagation lives in `sender.ts` and
`receiver.ts`. See `packages/iedora-identity/README.md`.

## Where to look when unsure

1. `node_modules/@vercel/otel/README.md` — version-matched docs.
2. The Configuration interface API:
   [otel.vercel.sh/api/interfaces/Configuration.html](https://otel.vercel.sh/api/interfaces/Configuration.html)
3. Next.js OTel guide:
   [nextjs.org/docs/app/guides/open-telemetry](https://nextjs.org/docs/app/guides/open-telemetry)
4. iedora's [`docs/observability.md`](../../docs/observability.md) — quickstart, dashboards, query recipes.
