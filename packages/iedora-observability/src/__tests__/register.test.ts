import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `registerIedoraOtel` must be a no-op when NODE_ENV === 'test'. This is
 * load-bearing for the PGLite Vitest suites in menu + genkan: they boot
 * 50+ test databases per run, and we don't want each one trying to reach
 * a non-existent OTLP collector.
 *
 * The check is also a quick smoke against accidentally calling
 * `registerOTel` from @vercel/otel in the test env (which would fail
 * loudly the first time CI ran).
 */
describe("registerIedoraOtel", () => {
  beforeEach(() => {
    // Each test gets a clean global-flag slate. The "already registered"
    // sentinel is intentionally process-scoped at runtime — for tests we
    // wipe it so each case starts from scratch.
    const g = globalThis as Record<string, unknown>;
    delete g.__iedora_otel_registered;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when NODE_ENV === 'test'", async () => {
    const { registerIedoraOtel } = await import("../register");
    // Vitest sets NODE_ENV=test by default — confirm the assumption then
    // call. No throw, no console output. The fact that this test exists
    // at all means @vercel/otel was importable without side-effects.
    expect(process.env.NODE_ENV).toBe("test");
    expect(() => registerIedoraOtel({ serviceName: "iedora-test" })).not.toThrow();
  });

  it("warns once when OTEL_EXPORTER_OTLP_ENDPOINT is unset and NODE_ENV !== 'test'", async () => {
    // Flip NODE_ENV for this case so the early return doesn't swallow
    // the warning. Restore on the way out.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-missing-endpoint" });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("OTEL_EXPORTER_OTLP_ENDPOINT not set"),
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      }
    }
  });

  it("does NOT warn when metricReaders is injected explicitly", async () => {
    // Tests + diagnostics may inject a reader without configuring an OTLP
    // endpoint. Suppressing the warning here keeps test output quiet — the
    // reader-only path is intentional, not a misconfiguration.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { registerIedoraOtel } = await import("../register");
      const {
        InMemoryMetricExporter,
        PeriodicExportingMetricReader,
        AggregationTemporality,
      } = await import("@opentelemetry/sdk-metrics");
      const reader = new PeriodicExportingMetricReader({
        exporter: new InMemoryMetricExporter(AggregationTemporality.DELTA),
        exportIntervalMillis: 60_000,
      });
      registerIedoraOtel({
        serviceName: "iedora-test-injected-reader",
        metricReaders: [reader],
      });
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      }
    }
  });

  it("passes resource attributes from the env to registerOTel", async () => {
    // Critical scenario: every span/metric carries service.version,
    // host.name, deployment.environment.name. Dashboards filter on these.
    // If a future refactor drops one (e.g. a typo on the env var name),
    // every dashboard's "by host" / "by version" breakdown silently
    // returns blank and we don't notice until someone tries to debug
    // a per-host incident.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const originalGitSha = process.env.GIT_SHA;
    const originalHostName = process.env.HOST_NAME;
    const originalDeploymentEnv = process.env.DEPLOYMENT_ENV;

    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";
    process.env.GIT_SHA = "abc1234deadbeef";
    process.env.HOST_NAME = "homelab-pt-01";
    process.env.DEPLOYMENT_ENV = "staging";

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-resource" });
      expect(registerOtelSpy).toHaveBeenCalledTimes(1);
      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        serviceName: string;
        attributes: Record<string, string>;
      };
      expect(config.serviceName).toBe("iedora-test-resource");
      expect(config.attributes).toMatchObject({
        // Canonical semconv keys — pinned by literal so a string drift
        // in @opentelemetry/semantic-conventions breaks the test, not
        // production dashboards.
        "service.name": "iedora-test-resource",
        "service.namespace": "iedora",
        "service.version": "abc1234deadbeef",
        "host.name": "homelab-pt-01",
        // DEPLOYMENT_ENV wins over NODE_ENV when both are set — matches
        // the "fleet manifest is the source of truth" intent from #8.
        "deployment.environment.name": "staging",
      });
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
      if (originalGitSha !== undefined) {
        process.env.GIT_SHA = originalGitSha;
      } else {
        delete process.env.GIT_SHA;
      }
      if (originalHostName !== undefined) {
        process.env.HOST_NAME = originalHostName;
      } else {
        delete process.env.HOST_NAME;
      }
      if (originalDeploymentEnv !== undefined) {
        process.env.DEPLOYMENT_ENV = originalDeploymentEnv;
      } else {
        delete process.env.DEPLOYMENT_ENV;
      }
    }
  });

  it("falls back to NODE_ENV when DEPLOYMENT_ENV is unset", async () => {
    // Most deploys today (pre-#8 fleet manifest) don't set DEPLOYMENT_ENV.
    // NODE_ENV is the fallback so dashboards still have something to filter
    // on. Pin the fallback ordering.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const originalDeploymentEnv = process.env.DEPLOYMENT_ENV;

    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";
    delete process.env.DEPLOYMENT_ENV;

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-fallback" });
      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      expect(config.attributes["deployment.environment.name"]).toBe("production");
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
      if (originalDeploymentEnv !== undefined) {
        process.env.DEPLOYMENT_ENV = originalDeploymentEnv;
      }
    }
  });

  it("omits service.version and host.name when their env vars are unset (no phantom empty labels)", async () => {
    // Local dev or first-boot edge case: GIT_SHA + HOST_NAME aren't set.
    // The package omits those keys (rather than setting them to empty
    // string) so OO dashboards don't grow a "(empty)" bucket. Pinned
    // here against a future "always set everything to ''" refactor.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const originalGitSha = process.env.GIT_SHA;
    const originalHostName = process.env.HOST_NAME;

    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";
    delete process.env.GIT_SHA;
    delete process.env.HOST_NAME;

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-min-env" });
      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        attributes: Record<string, string>;
      };
      // Pinned omissions.
      expect("service.version" in config.attributes).toBe(false);
      expect("host.name" in config.attributes).toBe(false);
      // Always-present keys still there.
      expect(config.attributes["service.name"]).toBeDefined();
      expect(config.attributes["service.namespace"]).toBe("iedora");
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
      if (originalGitSha !== undefined) {
        process.env.GIT_SHA = originalGitSha;
      }
      if (originalHostName !== undefined) {
        process.env.HOST_NAME = originalHostName;
      }
    }
  });

  it("passes a TenantContextSpanProcessor to @vercel/otel via spanProcessors", async () => {
    // Load-bearing: without this processor in the pipeline, every
    // tenantContext.run(...) call would silently fail to stamp tenant
    // attribution on child spans — dashboards filtered by
    // tenant.restaurant_id would silently miss spans.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      // Stub class so register.ts can `new OTLPHttpProtoTraceExporter(...)`
      // without dragging the real fetch-based exporter into the test.
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      const { TenantContextSpanProcessor } = await import("../processor");
      registerIedoraOtel({ serviceName: "iedora-test-spanproc" });

      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        spanProcessors: unknown[];
      };
      expect(Array.isArray(config.spanProcessors)).toBe(true);
      // First processor MUST be the tenant context processor — that's
      // what makes tenantContext.run(...) work end-to-end. Pinned to
      // the index so a future "always-prepend something" refactor
      // doesn't accidentally bury it behind another processor.
      expect(config.spanProcessors[0]).toBeInstanceOf(TenantContextSpanProcessor);
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
    }
  });

  it("appends extraSpanProcessors after the TenantContextSpanProcessor", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      // Stub class so register.ts can `new OTLPHttpProtoTraceExporter(...)`
      // without dragging the real fetch-based exporter into the test.
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      const { TenantContextSpanProcessor } = await import("../processor");
      const extraProcessor = {
        onStart: () => {},
        onEnd: () => {},
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      };
      registerIedoraOtel({
        serviceName: "iedora-test-extra-procs",
        extraSpanProcessors: [extraProcessor],
      });

      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        spanProcessors: unknown[];
      };
      expect(config.spanProcessors).toHaveLength(2);
      expect(config.spanProcessors[0]).toBeInstanceOf(TenantContextSpanProcessor);
      expect(config.spanProcessors[1]).toBe(extraProcessor);
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
    }
  });

  it("wires a BatchLogRecordProcessor when OTLP endpoint is set", async () => {
    // Without this, pino records bridged through PinoInstrumentation
    // would emit against the global LoggerProvider, which @vercel/otel
    // only installs when at least one logRecordProcessor is supplied.
    // Empty array = no global provider → pino records silently drop.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      // Stub class so register.ts can `new OTLPHttpProtoTraceExporter(...)`
      // without dragging the real fetch-based exporter into the test.
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-logs" });

      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        logRecordProcessors: unknown[];
      };
      expect(Array.isArray(config.logRecordProcessors)).toBe(true);
      expect(config.logRecordProcessors).toHaveLength(1);
      // BatchLogRecordProcessor (vs SimpleLogRecordProcessor) is the
      // pinned choice — 5s batch window avoids per-record export
      // amplification at our log volume.
      expect(config.logRecordProcessors[0]?.constructor.name).toBe(
        "BatchLogRecordProcessor",
      );
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
    }
  });

  it("does NOT wire log processors when OTLP endpoint is unset and no override is provided", async () => {
    // Local dev without an OO instance running: the SDK should not
    // try to batch logs against a non-existent endpoint. Empty array
    // is the expected shape — @vercel/otel skips global LoggerProvider
    // installation in that case, which is fine for dev.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "development";
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      // Stub class so register.ts can `new OTLPHttpProtoTraceExporter(...)`
      // without dragging the real fetch-based exporter into the test.
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));
    // Suppress the unset-endpoint warning during this test.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-no-logs" });

      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        logRecordProcessors: unknown[];
      };
      expect(config.logRecordProcessors).toEqual([]);
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      }
    }
  });

  it("registers PinoInstrumentation alongside the fetch instrumentation", async () => {
    // The pino bridge is what makes logger.info(...) calls in app code
    // flow through OTel — without it, logs only land on stdout and trace
    // correlation breaks. The fetch instrumentation must stay too
    // (it's how outbound traces propagate W3C traceparent across services).
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";

    vi.resetModules();
    const registerOtelSpy = vi.fn();
    vi.doMock("@vercel/otel", () => ({
      registerOTel: registerOtelSpy,
      // Stub class so register.ts can `new OTLPHttpProtoTraceExporter(...)`
      // without dragging the real fetch-based exporter into the test.
      OTLPHttpProtoTraceExporter: class {
        constructor(_opts?: unknown) {}
      },
    }));

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-pino" });

      const config = registerOtelSpy.mock.calls[0]?.[0] as {
        instrumentations: unknown[];
      };
      expect(Array.isArray(config.instrumentations)).toBe(true);
      // "fetch" is @vercel/otel's named default — keep it.
      expect(config.instrumentations).toContain("fetch");
      // Pino instrumentation is identified by its constructor name —
      // matching by instance type would force importing the class here,
      // which makes the doMock branch above more fragile.
      const pinoInstr = config.instrumentations.find(
        (i): i is { constructor: { name: string } } =>
          typeof i === "object" &&
          i !== null &&
          "constructor" in i &&
          (i as { constructor?: { name?: string } }).constructor?.name ===
            "PinoInstrumentation",
      );
      expect(pinoInstr).toBeDefined();
    } finally {
      vi.doUnmock("@vercel/otel");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
    }
  });

  it("constructs the OTLP metric exporter with DELTA temporality (counters are sum-aggregatable)", async () => {
    // Pinned against the OTLP exporter default (CUMULATIVE). Caught by
    // Codex on PR #14: a CUMULATIVE counter sends process-lifetime totals
    // on every flush, so every documented `sum(value)` query in
    // docs/observability.md would re-count the same events for the
    // lifetime of the container. DELTA reports "events since last flush"
    // — sum() over a window then gives the right answer.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.NODE_ENV = "production";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://infra-openobserve.test:5080/api/default";

    // Spy on the exporter constructor through a module mock. Reset module
    // graph so the spy applies to the import chain register.ts uses.
    vi.resetModules();
    const exporterSpy = vi.fn();
    vi.doMock("@opentelemetry/exporter-metrics-otlp-http", async () => {
      const actual = await vi.importActual<
        typeof import("@opentelemetry/exporter-metrics-otlp-http")
      >("@opentelemetry/exporter-metrics-otlp-http");
      return {
        ...actual,
        OTLPMetricExporter: class SpiedExporter {
          constructor(opts?: unknown) {
            exporterSpy(opts);
          }
          // Cast/satisfy the MetricExporter contract just enough for
          // PeriodicExportingMetricReader's constructor to accept it.
          export(): void {}
          forceFlush(): Promise<void> {
            return Promise.resolve();
          }
          shutdown(): Promise<void> {
            return Promise.resolve();
          }
          selectAggregation(): typeof actual.AggregationTemporalityPreference {
            return actual.AggregationTemporalityPreference;
          }
          selectAggregationTemporality(): unknown {
            return actual.AggregationTemporalityPreference.DELTA;
          }
        },
      };
    });

    try {
      const { registerIedoraOtel } = await import("../register");
      registerIedoraOtel({ serviceName: "iedora-test-delta" });
      expect(exporterSpy).toHaveBeenCalledTimes(1);
      const passedOptions = exporterSpy.mock.calls[0]?.[0] as
        | { temporalityPreference?: number }
        | undefined;
      // AggregationTemporalityPreference.DELTA === 0 per the enum definition
      // in @opentelemetry/exporter-metrics-otlp-http. We assert the value
      // explicitly because importing the enum from the mocked module is
      // intentionally awkward; the numeric pin is the contract.
      expect(passedOptions?.temporalityPreference).toBe(0);
    } finally {
      vi.doUnmock("@opentelemetry/exporter-metrics-otlp-http");
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEndpoint !== undefined) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
    }
  });
});
