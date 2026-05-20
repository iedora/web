# Observability

OpenTelemetry traces + metrics from every product to a single self-hosted OpenObserve instance. One UI, one query language, one trace across product boundaries.

## Architecture

```
products            wrapper                backend
─────────           ─────────────────      ─────────────────────────────
iedora-menu   ────▶ @iedora/observability ──OTLP-HTTP──▶ infra-openobserve
                    + @vercel/otel                       ├─ UI at obs.iedora.com (Caddy + Zitadel SSO TBD)
                                                         ├─ OTLP receiver on :5080
                                                         ├─ hot tier: local disk
                                                         └─ cold tier: R2 (iedora-observability bucket)
```

`obs.iedora.com` is a grey-cloud A record → Hetzner VPS → `infra-caddy` reverse-proxy → `infra-openobserve:5080`. Adding a new product = one line in its `instrumentation.ts`. Swapping exporters (Honeycomb, Tempo, Datadog) = one env var; products don't change.

## Quickstart — wiring a new product

```ts
// instrumentation.ts
import { registerIedoraOtel } from '@iedora/observability'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  registerIedoraOtel({ serviceName: 'iedora-yourproduct' })
}
```

```json
// package.json
"dependencies": { "@iedora/observability": "workspace:*" }
```

Env (set in Tofu's container env via BWS):

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://infra-openobserve:5080/api/default
OTEL_EXPORTER_OTLP_HEADERS=<Basic Auth header — see below>
HOST_NAME=<the Hetzner public IPv4 or hostname>
```

That's it. The package handles resource attributes, sampling, the noise filter, and no-op-in-tests.

## Resource attributes (every span)

| Attribute | Source |
|---|---|
| `service.namespace` | `iedora` (constant) |
| `service.name` | `opts.serviceName` (e.g. `iedora-menu`) |
| `service.version` | `process.env.GIT_SHA` (injected at build) |
| `deployment.environment.name` | `process.env.DEPLOYMENT_ENV` ?? `NODE_ENV` |
| `host.name` | `process.env.HOST_NAME` |

Filter by `service.namespace = "iedora"` to scope to the estate; by `service.name` to one product.

## Tenant attributes (per span)

Tenancy lives on **spans**, not resources — one process serves N restaurants. Use `withTenantSpan`:

```ts
import { withTenantSpan } from '@iedora/observability'

await withTenantSpan(
  'load-public-menu',
  { restaurantId, organizationId },
  async () => loadRestaurantSnapshot(slug),
)
```

Sets `tenant.restaurant_id` and `tenant.organization_id`. Search OpenObserve by those keys to follow one tenant's traffic.

## Cross-product trace context

`@vercel/otel` propagates W3C `traceparent` on every outbound `fetch` automatically, and Next 16 picks it up inbound. So menu → identity (whenever the Zitadel adapter lands) is stitched automatically. Webhook senders in `@iedora/identity` inject `traceparent`; receivers extract it.

## Sampling

| Environment | Root sampler | Parent honoured? |
|---|---|---|
| `production` | `TraceIdRatioBasedSampler(0.1)` (10%) | Yes |
| anything else | `AlwaysOnSampler` (100%) | Yes |

Both wrap a noise filter that drops `GET /up` and `GET /api/track/*` — the two highest-volume / lowest-value spans.

To add a noise pattern: `packages/iedora-observability/src/register.ts` (`NOISE_PATTERNS`).

## OpenObserve — operational notes

| Layer | Spec |
|---|---|
| Container image | `public.ecr.aws/zinclabs/openobserve:v0.80.3` |
| HTTP port | 5080 (UI + OTLP) |
| Hot data | Local disk (`/data` bind-mounted on host) |
| Cold data | R2 bucket `iedora-observability` (Tofu-managed) |
| Mode | `ZO_LOCAL_MODE=true` (single binary) |

Cluster mode (multiple replicas, PG meta store) is a Phase-2+ concern.

### Bootstrap secrets

| BWS key | Value |
|---|---|
| `INFRA_OPENOBSERVE_ROOT_USER_EMAIL` | Admin email — UI login |
| `INFRA_OPENOBSERVE_ROOT_USER_PASSWORD` | Strong random — `openssl rand -base64 32` |
| `INFRA_OPENOBSERVE_INGEST_HEADER` | Pre-baked `Authorization=Basic%20<base64(email:password)>` |

Build the ingest header:

```bash
echo -n "$EMAIL:$PASSWORD" | base64 -w0 | xargs -I{} echo "Authorization=Basic%20{}"
```

For better posture, create a dedicated `iedora-ingest@iedora.com` user with ingest-only role after first boot; rotate the header to use those credentials.

### UI access

`obs.iedora.com` resolves to the VPS directly (no Cloudflare Tunnel, no Cloudflare Access). Caddy terminates TLS and reverse-proxies to OpenObserve, which serves its own login screen (root creds).

> The previous Cloudflare-Access-via-genkan layer is gone (decommissioned with genkan). When Zitadel-based SSO for OpenObserve is needed, add an `oauth2-proxy` accessory between Caddy and OpenObserve (OpenObserve OSS doesn't speak OIDC natively).

### Tofu-managed resources

`infra/tofu/main.tf` provisions:
- `cloudflare_r2_bucket.observability` — cold tier.
- `cloudflare_api_token.observability_r2` — scoped to that bucket.
- `cloudflare_dns_record.obs` — A record → Hetzner IPv4.

### Day-to-day ops

```
just infra::deploy                # provisions R2 + boots accessory
just infra::logs openobserve      # tail container logs
just infra::rotate-secret INFRA_OPENOBSERVE_ROOT_USER_PASSWORD
```

## Querying — common recipes

Open `https://obs.iedora.com` → log in → Traces tab.

### One tenant's traffic, last hour

```sql
SELECT * FROM "default"
WHERE tenant.restaurant_id = 'r_abc123'
  AND timestamp > now() - INTERVAL '1 hour'
ORDER BY timestamp DESC
```

### Errors over the last 15 minutes

```sql
SELECT * FROM "default"
WHERE service.name = 'iedora-menu'
  AND status_code = 'ERROR'
  AND timestamp > now() - INTERVAL '15 minute'
```

### One trace end-to-end

Click any span → "View full trace". The UI stitches spans across products by shared trace ID.

## Local development

Default: no OTLP endpoint set → SDK logs once at boot, never exports. Fine for local iteration.

For local trace visibility, boot a separate OpenObserve via Docker:

```bash
docker run -d --name local-openobserve \
  -p 5080:5080 \
  -e ZO_ROOT_USER_EMAIL=local@iedora.com \
  -e ZO_ROOT_USER_PASSWORD=local-dev-only \
  public.ecr.aws/zinclabs/openobserve:v0.80.3
```

```bash
# In .env.local:
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5080/api/default
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20bG9jYWxAaWVkb3JhLmNvbTpsb2NhbC1kZXYtb25seQ==
```

## Test environment

`registerIedoraOtel` is a no-op when `NODE_ENV === 'test'`. Vitest runs without the SDK booting; `withTenantSpan` and `tracer` degrade to the global no-op tracer from `@opentelemetry/api`.

## Metrics

OTel metrics flow through the same package as traces — one set of resource attributes, one OTLP config, one OpenObserve org. `registerIedoraOtel` configures a `PeriodicExportingMetricReader` (60s interval, **DELTA temporality**).

> **Why DELTA, not CUMULATIVE.** OTel's OTLP exporter defaults to cumulative — sends the process-lifetime counter total on every flush. Our dashboards use `sum(value)`; cumulative would re-count every prior event on every flush, making "views in the last hour" grow unbounded. DELTA exports "events since last flush", so `sum(value)` over a window gives the right answer.

### Surface

```ts
import { meter, tenantAttributes } from '@iedora/observability'

const counter = meter.createCounter('iedora.something_total', {
  description: 'What you are counting',
  unit: 'operation',
})
counter.add(1, tenantAttributes({ restaurantId, organizationId }))

const dur = meter.createHistogram('iedora.work_duration_ms')
dur.record(elapsedMs, tenantAttributes({ restaurantId }))
```

### Conventions

- Names: lowercase snake_case, `iedora.` namespace. Distinct from Next 16's auto-emitted `http.server.*`.
- Counters end `_total`. Histograms end `_ms` for latency, `_bytes` for sizes.
- Tenant labels via `tenantAttributes(...)` — same keys as spans, so the same filter works against both signals.
- Bound-cardinality labels only. Restaurant IDs fine; user IDs NOT (would explode label space).

### What's emitted today

| Metric | Type | Where | Labels |
|---|---|---|---|
| `iedora.restaurant_views_total` | Counter | menu — `src/features/metrics/index.ts` | `tenant.restaurant_id`, `tenant.organization_id`, `iedora.language` |
| `http.server.request.duration` | Histogram (ms) | Auto-instrumented by Next 16 | `http.method`, `http.route`, `http.status_code` |
| `http.server.active_requests` | UpDownCounter | Auto-instrumented by Next 16 | `http.method`, `http.route` |

### Query recipes (Metrics tab)

OpenObserve normalizes dotted labels to underscored column names — `tenant.restaurant_id` becomes `tenant_restaurant_id`.

#### One restaurant's daily views this week

```sql
SELECT toStartOfDay(timestamp) AS day, sum(value) AS views
FROM metrics
WHERE metric_name = 'iedora.restaurant_views_total'
  AND tenant_restaurant_id = 'r_abc123'
  AND timestamp > now() - INTERVAL '7 day'
GROUP BY day ORDER BY day
```

#### p95 request latency per route

```sql
SELECT http_route, quantile(0.95)(value) AS p95_ms
FROM metrics
WHERE metric_name = 'http.server.request.duration'
  AND service_name = 'iedora-menu'
  AND timestamp > now() - INTERVAL '15 minute'
GROUP BY http_route ORDER BY p95_ms DESC
```

### Adding a metric

1. Pick name + type.
2. Create the instrument once at module load: `const x = meter.createCounter(...)`.
3. Increment / record with `tenantAttributes(...)` when tenant-scoped.
4. Add a row to the table above + a query recipe if load-bearing.

No PR to `@iedora/observability` for routine additions — only wrapper plumbing lives there.

## Not yet shipped

- **Logs.** `@opentelemetry/sdk-logs` is still 0.x. Container logs via `just infra::logs <svc>` until 1.0.
- **Browser RUM.** OpenObserve has a RUM SDK; not wired yet.
- **OpenObserve UI SSO via Zitadel.** Currently uses root creds. Plan: `oauth2-proxy` accessory in front of Caddy → OpenObserve.
- **Better Auth telemetry.** Stays OFF.
