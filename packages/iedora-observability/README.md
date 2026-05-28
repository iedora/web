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
  meter,
  logger,
  withTenantSpan,
  tenantContext,
  IEDORA_RESTAURANT_ID,
} from "@iedora/observability";
```

| Export                 | Use                                                                            |
| ---------------------- | ------------------------------------------------------------------------------ |
| `registerIedoraOtel`   | Called once from the product's `instrumentation.ts::register()`.               |
| `tracer`               | Pre-configured `Tracer` instance for custom spans.                             |
| `meter`                | Pre-configured `Meter` instance for counters / histograms / gauges.            |
| `logger`               | Pre-configured `Logger` (api-logs). Most code uses pino — the bridge forwards records automatically. |
| `withTenantSpan`       | Wrap a request-scoped operation in a span tagged with `tenant.restaurant_id`.  |
| `tenantContext.run`    | Set tenant on the active scope once at an entrypoint; child spans inherit attribution via `TenantContextSpanProcessor`. |
| `tenantAttributes`     | Build the canonical tenant-attribute record for metric `.add` / `.record` calls. |
| `TenantContextSpanProcessor` | The processor wired automatically by `registerIedoraOtel` — exported for tests. |
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
| `host.name`                      | `process.env.HOST_NAME`                             |

These match the iedora fleet manifest one-to-one — see issue #8 for the
manifest → resource-attribute derivation.

### Tenant attributes (per span)

Tenancy lives on **spans**, not resources. One Node process serves N
restaurants; `restaurant.id` on a resource would be wrong (resources are
per-process). Three ways to attribute:

1. **`tenantContext.run({ restaurantId, organizationId }, fn)`** — set
   once at an entrypoint (typically the auth boundary,
   `requireRestaurantAccess`). Every span started inside `fn` — including
   ones deep inside Drizzle adapters or `withTenantSpan` blocks that
   don't know what tenant they belong to — gets `tenant.restaurant_id`
   stamped on by `TenantContextSpanProcessor`. This is the canonical
   pattern, modeled on Trigger.dev's `DatasourceAttributeSpanProcessor`
   (`apps/webapp/app/v3/tracer.server.ts`).
2. **`withTenantSpan('op-name', { restaurantId, ... }, fn)`** — wrap a
   single operation. Explicit, useful at slice boundaries where you
   want a span name pinned to a business verb.
3. **`tenantAttributes({ restaurantId, ... })`** on metric `.add()` /
   `.record()` calls. Same key constants, so the same OO query filter
   joins spans and metrics in lock-step.

The processor reads from an `AsyncLocalStorage`-backed store (not OTel's
Context). That sidesteps the NoopContextManager-in-tests problem: ALS
propagates through async hops in both test and production runtimes
without any setup.

### Logs (`@opentelemetry/sdk-logs` + `@opentelemetry/instrumentation-pino`)

`registerIedoraOtel` wires a `BatchLogRecordProcessor` over `OTLPLogExporter`
when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Pair that with pino in app
code — `@opentelemetry/instrumentation-pino` is registered automatically
and bridges every pino record into the global LoggerProvider, injecting
`trace_id` and `span_id` from the active context.

```ts
import pino from "pino";
const log = pino();

log.info({ restaurantId: "r_abc" }, "menu published");
// In OO, this record carries: { trace_id, span_id, restaurant_id, ... }
```

Apps that haven't migrated to pino are unaffected — the instrumentation
is a no-op until pino is required. Direct `logger.emit(...)` calls
against the package's `logger` export work too, for the rare case where
you want to emit a structured event without going through pino.

### Sampling

| Environment   | Root sampler                            | Parent honoured? |
| ------------- | --------------------------------------- | ---------------- |
| `production`  | `TraceIdRatioBasedSampler(0.1)` (10%)   | Yes              |
| anything else | `AlwaysOnSampler` (100%)                | Yes              |

Both wrap a `NoiseFilteringSampler` that drops the high-volume,
low-value spans before any decision is made:

- `GET /up` — uptime health checks (one per second per host via CF Tunnel).
- `GET /api/track/*` — public-menu view beacon (already counted via
  the `iedora.restaurant_views_total` metric).
- `GET /api/health` / `GET /api/ready` — reserved for future container
  probes following the same convention.

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
`traceparent` header on every outbound `fetch` automatically (so
menu → R2/S3 puts and any future inter-product HTTP calls stitch into
one trace with no extra code). Inbound propagation in Next 16 is
automatic too. There are no inter-product fetches today.

## Where to look when unsure

1. `node_modules/@vercel/otel/README.md` — version-matched docs.
2. The Configuration interface API:
   [otel.vercel.sh/api/interfaces/Configuration.html](https://otel.vercel.sh/api/interfaces/Configuration.html)
3. Next.js OTel guide:
   [nextjs.org/docs/app/guides/open-telemetry](https://nextjs.org/docs/app/guides/open-telemetry)
4. iedora's [`docs/deploy/README.md`](../../docs/deploy/README.md) — quickstart, dashboards, query recipes.
