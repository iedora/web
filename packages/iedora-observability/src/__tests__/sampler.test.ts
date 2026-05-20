import { describe, expect, it } from "vitest";
import {
  SamplingDecision,
  type Sampler,
  type SamplingResult,
} from "@opentelemetry/sdk-trace-base";
import {
  ROOT_CONTEXT,
  SpanKind,
  TraceFlags,
  trace,
  type Context,
} from "@opentelemetry/api";

import {
  NoiseFilteringSampler,
  NOISE_PATTERNS,
  defaultSampler,
} from "../register";

/**
 * Counting stub sampler — wraps the inner sampling decision behind a
 * call counter so we can assert "the inner sampler was never even asked"
 * for noise-filtered spans. Critical scenario: a regression that lets
 * `/up` through and adjusts the budget downstream still costs sampler
 * CPU; the filter must short-circuit BEFORE the inner sampler runs.
 */
class CountingSampler implements Sampler {
  calls = 0;
  constructor(private readonly result: SamplingResult) {}
  shouldSample(): SamplingResult {
    this.calls += 1;
    return this.result;
  }
  toString(): string {
    return `Counting(${this.calls})`;
  }
}

const RECORD_AND_SAMPLED: SamplingResult = {
  decision: SamplingDecision.RECORD_AND_SAMPLED,
};
const NOT_RECORD: SamplingResult = { decision: SamplingDecision.NOT_RECORD };

function callShouldSample(
  sampler: Sampler,
  spanName: string,
  ctx: Context = ROOT_CONTEXT,
): SamplingResult {
  // Standard arg shape per Sampler interface — links empty, kind SERVER
  // (the spans we'd filter come from Next 16's auto-instrumented HTTP
  // server handlers; using SERVER here matches reality).
  return sampler.shouldSample(
    ctx,
    "00000000000000000000000000000000",
    spanName,
    SpanKind.SERVER,
    {},
    [],
  );
}

describe("NoiseFilteringSampler", () => {
  it("drops the patterns load-bearingly listed in NOISE_PATTERNS without consulting the inner sampler", () => {
    // Real-world scenarios this protects:
    //   - Caddy + uptime probes hit /up once per second per replica —
    //     that's 86,400 spans/host/day. At 10% sampling that's still
    //     8,640 spans/day of pure health-check noise.
    //   - /api/track/[slug] is the public-menu view beacon — fires
    //     once per real visit, deduped at the DB level. Tracing it
    //     adds nothing the view counter doesn't already show.
    const inner = new CountingSampler(RECORD_AND_SAMPLED);
    const sampler = new NoiseFilteringSampler(inner);

    const dropped = [
      "GET /up",
      "POST /up",
      "GET /api/track/r-abc-123",
      "GET /api/track/some-slug/sub",
    ];
    for (const name of dropped) {
      expect(callShouldSample(sampler, name).decision).toBe(
        SamplingDecision.NOT_RECORD,
      );
    }
    // The inner sampler is the budget we're trying to protect. It must
    // not have been called once.
    expect(inner.calls).toBe(0);
  });

  it("delegates to the inner sampler for spans that don't match the denylist", () => {
    const inner = new CountingSampler(RECORD_AND_SAMPLED);
    const sampler = new NoiseFilteringSampler(inner);

    const allowed = [
      "GET /r/some-restaurant",
      "GET /api/identity/organization/list",
      "POST /api/auth/[...all]",
      // Same word as `/up` but as part of a different route — must not
      // accidentally match. The `\s\/up$` anchor is what stops this.
      "GET /up-and-running",
      "GET /uppercase",
      // `track` as a path segment unrelated to /api/track/ must pass.
      "GET /dashboard/r/abc/menu/track-changes",
    ];
    for (const name of allowed) {
      expect(callShouldSample(sampler, name).decision).toBe(
        SamplingDecision.RECORD_AND_SAMPLED,
      );
    }
    expect(inner.calls).toBe(allowed.length);
  });

  it("forwards the inner sampler's NOT_RECORD verdict when nothing matches", () => {
    // The filter doesn't second-guess the inner sampler — if the inner
    // says NOT_RECORD (e.g. trace-id-ratio rolled "skip"), the filter
    // preserves that. No accidental upgrades to RECORD.
    const inner = new CountingSampler(NOT_RECORD);
    const sampler = new NoiseFilteringSampler(inner);
    expect(
      callShouldSample(sampler, "GET /r/some-restaurant").decision,
    ).toBe(SamplingDecision.NOT_RECORD);
    expect(inner.calls).toBe(1);
  });

  it("toString carries the inner sampler's identity for debugging", () => {
    const inner = new CountingSampler(RECORD_AND_SAMPLED);
    const sampler = new NoiseFilteringSampler(inner);
    expect(sampler.toString()).toContain("Counting");
    expect(sampler.toString()).toContain("IedoraNoiseFilter");
  });

  it("NOISE_PATTERNS is the pinned filter contract", () => {
    // Two patterns are load-bearing for the budget. Adding more later
    // is fine; reordering or removing one breaks the dashboard noise
    // floor in OO. Pin to catch accidental removal.
    expect(NOISE_PATTERNS).toHaveLength(2);
    expect(NOISE_PATTERNS[0]!.test("GET /up")).toBe(true);
    expect(NOISE_PATTERNS[1]!.test("GET /api/track/x")).toBe(true);
  });
});

describe("defaultSampler — parent-based cross-product correctness", () => {
  // The cross-product (menu → genkan) trace stitching only works if
  // both processes agree on whether the trace is sampled. ParentBased
  // honours the upstream's decision (via the traceparent's traceFlags);
  // the root sampler only fires when there's no parent. These tests
  // pin that contract — a regression here means half-traces in OO with
  // spans pointing at parents that were never recorded.

  function ctxWithRemoteSpan(traceFlags: number): Context {
    return trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags,
      isRemote: true,
    });
  }

  it("samples a child when the remote parent was sampled (sampled-flag=01)", () => {
    // Real scenario: menu's outbound fetch to genkan was sampled.
    // The traceparent header carries `01` in the flags byte. Genkan's
    // inbound span MUST be recorded — otherwise OO shows menu's span
    // pointing at a nonexistent parent.
    const sampler = defaultSampler("production");
    const ctx = ctxWithRemoteSpan(TraceFlags.SAMPLED);
    expect(callShouldSample(sampler, "GET /api/identity/foo", ctx).decision).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("drops a child when the remote parent was not sampled (sampled-flag=00) — even in prod", () => {
    // Real scenario: menu's outbound was NOT sampled (the 10% ratio
    // skipped it). genkan must also NOT sample, otherwise OO shows an
    // orphaned span with no parent context.
    const sampler = defaultSampler("production");
    const ctx = ctxWithRemoteSpan(TraceFlags.NONE);
    expect(callShouldSample(sampler, "GET /api/identity/foo", ctx).decision).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("falls back to the dev root sampler (always-on) when there's no parent in non-prod", () => {
    // Root-spawned spans in dev/test get 100% sampling so local debugging
    // catches everything. The noise filter still applies.
    const sampler = defaultSampler("development");
    expect(callShouldSample(sampler, "GET /r/some-restaurant").decision).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    // Filter still in front.
    expect(callShouldSample(sampler, "GET /up").decision).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("uses the 10% trace-id ratio root sampler in production", () => {
    // Sampling is deterministic by traceId — we don't try to flip a
    // coin per call. Same traceId on every shouldSample() call → same
    // decision. Pin one known-sampled trace id and one known-not-sampled
    // one so this test is stable across runs.
    //
    // TraceIdRatioBasedSampler at 0.1 uses the high 64 bits of the trace
    // id. We don't pin specific ids (the algorithm could change between
    // SDK versions); instead we sample N random ids and assert that
    // ~10% are sampled. With N=1000 the variance is small enough.
    const sampler = defaultSampler("production");
    let sampled = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      // Random hex trace id — 16 bytes = 32 hex chars
      const id = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("");
      const result = sampler.shouldSample(
        ROOT_CONTEXT,
        id,
        "GET /api/identity/foo",
        SpanKind.SERVER,
        {},
        [],
      );
      if (result.decision === SamplingDecision.RECORD_AND_SAMPLED) sampled++;
    }
    // 10% target, ±3% tolerance. Real-world: 10/100 = 10%, 100/1000 = 10%
    // with stddev around ~1%. 3% is generous.
    expect(sampled / N).toBeGreaterThan(0.07);
    expect(sampled / N).toBeLessThan(0.13);
  });
});
