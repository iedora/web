import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { metrics } from '@opentelemetry/api'

// The metrics barrel reads `meter` at module-load time, which resolves
// through the global MeterProvider. The setup below installs a real
// MeterProvider with an InMemoryMetricExporter BEFORE the barrel is
// imported, so the counter we wire in features/metrics/index.ts actually
// flushes through to assertions.
vi.mock('server-only', () => ({}))

let exporter: InMemoryMetricExporter
let provider: MeterProvider
// Holds a reference to the metrics module so we can reach the barrel's
// public API. Imported fresh after the global meter provider is wired.
let metricsModule: typeof import('./index')

beforeEach(async () => {
  vi.resetModules()
  exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA)
  const reader = new PeriodicExportingMetricReader({
    exporter,
    // Long interval — we forceFlush before reading, this is just a safety
    // net so an unlucky test scheduler doesn't try to flush mid-assertion.
    exportIntervalMillis: 60_000,
  })
  provider = new MeterProvider({ readers: [reader] })
  // Setting the global provider before any module reads `metrics.getMeter()`
  // ensures the barrel's `meter` is bound to our test-controlled instance.
  metrics.disable()
  metrics.setGlobalMeterProvider(provider)

  // Replace the drizzle adapter so the test doesn't need a real DB. Returns
  // a resolved promise for every method we actually call; the barrel test
  // is about wiring (does the counter fire?), not about Drizzle SQL.
  vi.doMock('./adapters/drizzle', () => ({
    drizzleMetrics: {
      incrementDailyView: vi.fn().mockResolvedValue(undefined),
      getOrganizationMonthlyViews: vi.fn().mockResolvedValue([]),
      getOrganizationAnalytics: vi.fn().mockResolvedValue(null),
    },
  }))

  metricsModule = await import('./index')
})

afterEach(async () => {
  await provider.shutdown()
  metrics.disable()
  vi.restoreAllMocks()
  vi.doUnmock('./adapters/drizzle')
})

async function readCounter(name: string) {
  await provider.forceFlush()
  const all = exporter
    .getMetrics()
    .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics))
  return all.find((m) => m.descriptor.name === name)
}

describe('metrics barrel — restaurant_views_total wiring', () => {
  it('fires +1 with the correct tenant + language labels on a fresh view', async () => {
    // Real-world scenario: one anonymous visitor hits a public menu page
    // in Portuguese for the first time this hour. The beacon route has
    // already confirmed it's a newly-tracked view; this call is the
    // chokepoint into both the daily_view table and the OTel counter.
    await metricsModule.incrementDailyView('r_pasta_place', 'o_lisbon_co', 'pt')

    const counter = await readCounter('iedora.restaurant_views_total')
    expect(counter, 'restaurant_views_total counter should be emitted').toBeDefined()
    expect(counter!.dataPoints).toHaveLength(1)
    expect(counter!.dataPoints[0]!.attributes).toEqual({
      'tenant.restaurant_id': 'r_pasta_place',
      'tenant.organization_id': 'o_lisbon_co',
      'iedora.language': 'pt',
    })
    expect(counter!.dataPoints[0]!.value).toBe(1)
  })

  it('keeps two restaurants on separate label sets (tenant isolation)', async () => {
    // Real-world business scenario: restaurant A under org 1 + restaurant
    // B under org 2 BOTH get a visitor at the same time. The counter must
    // not collapse them — analytics per restaurant depends on the
    // restaurant_id label staying distinct.
    await metricsModule.incrementDailyView('r_a', 'o_1', 'en')
    await metricsModule.incrementDailyView('r_b', 'o_2', 'en')
    // And a second hit on restaurant A — must aggregate INTO r_a's bucket.
    await metricsModule.incrementDailyView('r_a', 'o_1', 'en')

    const counter = await readCounter('iedora.restaurant_views_total')
    expect(counter).toBeDefined()
    expect(counter!.dataPoints).toHaveLength(2)

    const byRestaurant = new Map(
      counter!.dataPoints.map((dp) => [
        dp.attributes['tenant.restaurant_id'] as string,
        dp.value as number,
      ]),
    )
    expect(byRestaurant.get('r_a')).toBe(2)
    expect(byRestaurant.get('r_b')).toBe(1)
  })

  it('splits the same restaurant across languages (per-language analytics)', async () => {
    // Real-world business scenario: a tourist-zone restaurant gets four
    // visitors — 2 PT, 1 EN, 1 ES — within the same hour. The counter's
    // language label lets us answer "what languages do my visitors actually
    // read?" without a separate query layer.
    await metricsModule.incrementDailyView('r_bairro', 'o_porto', 'pt')
    await metricsModule.incrementDailyView('r_bairro', 'o_porto', 'pt')
    await metricsModule.incrementDailyView('r_bairro', 'o_porto', 'en')
    await metricsModule.incrementDailyView('r_bairro', 'o_porto', 'es')

    const counter = await readCounter('iedora.restaurant_views_total')
    expect(counter).toBeDefined()
    expect(counter!.dataPoints).toHaveLength(3)

    const byLanguage = new Map(
      counter!.dataPoints.map((dp) => [
        dp.attributes['iedora.language'] as string,
        dp.value as number,
      ]),
    )
    expect(byLanguage.get('pt')).toBe(2)
    expect(byLanguage.get('en')).toBe(1)
    expect(byLanguage.get('es')).toBe(1)
  })

  it('still fires the counter when the DB write throws', async () => {
    // Critical scenario: Postgres is degraded, the daily_view upsert
    // fails. The counter MUST still record the visit so the divergence
    // (metric vs row count) becomes a visible alert signal instead of
    // a silent gap. The barrel's intentional ordering (counter first,
    // then DB) is what makes this work — guard against future refactors
    // that flip the order.
    vi.doMock('./adapters/drizzle', () => ({
      drizzleMetrics: {
        incrementDailyView: vi.fn().mockRejectedValue(new Error('pg down')),
        getOrganizationMonthlyViews: vi.fn().mockResolvedValue([]),
        getOrganizationAnalytics: vi.fn().mockResolvedValue(null),
      },
    }))
    // Re-import so the new mock is picked up.
    vi.resetModules()
    const fresh = await import('./index')

    await expect(
      fresh.incrementDailyView('r_pg_down', 'o_pg_down', 'en'),
    ).rejects.toThrow('pg down')

    const counter = await readCounter('iedora.restaurant_views_total')
    expect(counter, 'counter must have fired even though DB threw').toBeDefined()
    expect(counter!.dataPoints).toHaveLength(1)
    expect(counter!.dataPoints[0]!.attributes['tenant.restaurant_id']).toBe(
      'r_pg_down',
    )
  })

  it('omits the organization label when the caller passes an empty string', async () => {
    // Edge case: while the route always has organizationId from the
    // snapshot, a future caller could pass an empty string (the type
    // says `string` — empty is technically valid). `tenantAttributes`
    // treats falsy strings the same as undefined and OMITS the label
    // entirely — better than emitting `'tenant.organization_id': ''`
    // which would create a phantom empty bucket in OO dashboards.
    await metricsModule.incrementDailyView('r_solo', '', 'en')

    const counter = await readCounter('iedora.restaurant_views_total')
    expect(counter).toBeDefined()
    expect(counter!.dataPoints).toHaveLength(1)
    const attrs = counter!.dataPoints[0]!.attributes
    expect(attrs['tenant.restaurant_id']).toBe('r_solo')
    // Key not present (vs present-but-undefined or present-but-empty).
    expect('tenant.organization_id' in attrs).toBe(false)
  })
})
