package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"

	"github.com/eduvhc/iedora/infra/migrate"
)

// `iedora migrate` applies every product's Drizzle migrations against
// a local-ish Postgres — the dev compose stack's `infra-postgres`
// container, or the GitHub Actions postgres service container in CI.
// Mirrors Stage 3 prod migration shape exactly: same image
// (infra/migrate/Dockerfile), same entrypoint layout
// (/migrate/<product>/scripts/migrate.mjs), same env shape as the
// Stage 3 configurators (infra/app-state/<product>-db-migrations/).
//
// Single source of truth for the product list lives in
// `infra/migrate.Specs`. This file is the local-execution glue:
//   - flags for dev / CI knobs (network, pg host)
//   - docker build of the migrate image from local source
//   - per-spec `docker run` via infra/migrate.LocalRun
//   - OTel wrap of each step + W3C TRACEPARENT propagation into the
//     container so the migrate.mjs spans hang off our spans

const (
	// migrateImageTag — local-only tag for the migrate image. We don't
	// pull from GHCR in dev/CI because (a) we want to test the current
	// branch's Dockerfile, not whatever shipped to main; (b) no network
	// dependency on the happy path. Build is fast (~5s warm, ~60s cold).
	migrateImageTag = "iedora-migrate:local"

	// Defaults that match dev/docker-compose.yml.
	defaultDockerNetwork = "iedora"
	defaultPostgresHost  = "infra-postgres"
	defaultPostgresPort  = "5432"
	defaultPostgresUser  = "postgres"
	defaultPostgresPass  = "Password1!"
)

// Tracer + meter — global no-ops until setupOtel() registers real
// providers. Safe to use unconditionally.
var (
	migrateTracer        = otel.Tracer("iedora")
	migrateMeter         = otel.Meter("iedora")
	migrateCounter       metric.Int64Counter
	migrateDuration      metric.Float64Histogram
	migrateBuildDuration metric.Float64Histogram
)

func init() {
	var err error
	migrateCounter, err = migrateMeter.Int64Counter(
		"iedora.orchestrator.migrations_total",
		metric.WithDescription("Total migrate-container runs from the orchestrator, by schema and outcome."),
	)
	if err != nil {
		panic(err)
	}
	migrateDuration, err = migrateMeter.Float64Histogram(
		"iedora.orchestrator.migration_duration_ms",
		metric.WithDescription("Wall-clock duration of a `docker run migrate` invocation."),
		metric.WithUnit("ms"),
	)
	if err != nil {
		panic(err)
	}
	migrateBuildDuration, err = migrateMeter.Float64Histogram(
		"iedora.orchestrator.migrate_image_build_ms",
		metric.WithDescription("Wall-clock duration of `docker build` of the migrate image."),
		metric.WithUnit("ms"),
	)
	if err != nil {
		panic(err)
	}
}

func runMigrate(ctx context.Context, argv []string) error {
	shutdown, err := setupOtel(ctx)
	if err != nil {
		return fmt.Errorf("setup otel: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdown(shutdownCtx)
	}()

	ctx, rootSpan := migrateTracer.Start(ctx, "iedora.migrate")
	defer rootSpan.End()

	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	repoRoot := fs.String("repo", "", "absolute path to the repo root (required)")
	only := fs.String("only", "", "run only one migrator by name (e.g. imopush)")
	skipBuild := fs.Bool("skip-build", false, "reuse a previously-built "+migrateImageTag+" image")
	network := fs.String("network", defaultDockerNetwork, "docker network the migrate container joins (use 'host' for CI where postgres is exposed via host ports)")
	pgHost := fs.String("pg-host", defaultPostgresHost, "postgres hostname as seen from inside the migrate container")
	pgPort := fs.String("pg-port", defaultPostgresPort, "postgres TCP port")
	pgUser := fs.String("pg-user", defaultPostgresUser, "postgres username")
	pgPassword := fs.String("pg-password", defaultPostgresPass, "postgres password (dev convention, override via flag in non-dev)")
	if err := fs.Parse(argv); err != nil {
		return err
	}
	if *repoRoot == "" {
		fs.Usage()
		return fmt.Errorf("--repo is required")
	}

	abs, err := filepath.Abs(*repoRoot)
	if err != nil {
		return fmt.Errorf("resolve --repo: %w", err)
	}
	if _, err := os.Stat(filepath.Join(abs, "package.json")); err != nil {
		return fmt.Errorf("--repo %q doesn't look like the repo root (no package.json): %w", abs, err)
	}

	if !*skipBuild {
		if err := buildMigrateImage(ctx, abs); err != nil {
			return fmt.Errorf("build migrate image: %w", err)
		}
	}

	// Extra env forwarded into the container — see W3C TRACEPARENT plus
	// OTel exporter config so the container emits to the same OO endpoint.
	extraEnv := []string{}
	for _, k := range []string{
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"DEPLOYMENT_ENV",
		"GIT_SHA",
		"HOST_NAME",
	} {
		if v := os.Getenv(k); v != "" {
			extraEnv = append(extraEnv, k+"="+v)
		}
	}

	for _, spec := range migrate.Specs {
		if *only != "" && *only != spec.Name {
			continue
		}
		if err := runOneLocal(ctx, spec, migrate.LocalConfig{
			Network:        *network,
			PGHost:         *pgHost,
			PGPort:         *pgPort,
			PGUser:         *pgUser,
			PGPassword:     *pgPassword,
			ImageTag:       migrateImageTag,
			TraceparentEnv: injectTraceparentEnv(ctx),
			ExtraEnv:       extraEnv,
		}); err != nil {
			return fmt.Errorf("migrate %s: %w", spec.Name, err)
		}
	}
	return nil
}

// buildMigrateImage runs `docker build` against infra/migrate/Dockerfile
// with the repo root as build context. Wrapped in a span + duration
// histogram.
func buildMigrateImage(ctx context.Context, repoRoot string) error {
	ctx, span := migrateTracer.Start(ctx, "migrate.docker_build",
		trace.WithAttributes(attribute.String("image.tag", migrateImageTag)),
	)
	defer span.End()

	startedAt := time.Now()
	fmt.Fprintf(os.Stderr, "→ iedora migrate: docker build %s\n", migrateImageTag)
	cmd := exec.CommandContext(ctx,
		"docker", "build",
		"-f", filepath.Join(repoRoot, "infra/migrate/Dockerfile"),
		"-t", migrateImageTag,
		repoRoot,
	)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	err := cmd.Run()

	elapsed := float64(time.Since(startedAt).Milliseconds())
	migrateBuildDuration.Record(ctx, elapsed)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return err
}

// runOneLocal wraps migrate.LocalRun in a per-product span + duration /
// outcome metrics. The actual docker exec lives in infra/migrate so
// Stage 3 (RemoteRun) and dev/CI (LocalRun) stay siblings of the same
// runner package.
func runOneLocal(ctx context.Context, s migrate.Spec, cfg migrate.LocalConfig) error {
	ctx, span := migrateTracer.Start(ctx, "migrate.docker_run",
		trace.WithAttributes(
			attribute.String("migrate.product", s.Name),
			attribute.String("db.name", s.DBName),
			attribute.String("docker.network", cfg.Network),
			attribute.String("db.host", cfg.PGHost),
		),
	)
	defer span.End()

	fmt.Fprintf(os.Stderr, "→ iedora migrate: %s (%s) — network=%s host=%s\n",
		s.Name, s.DBName, cfg.Network, cfg.PGHost)

	startedAt := time.Now()
	err := migrate.LocalRun(ctx, s, cfg)

	elapsed := float64(time.Since(startedAt).Milliseconds())
	outcome := "ok"
	if err != nil {
		outcome = "fail"
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	migrateCounter.Add(ctx, 1,
		metric.WithAttributes(
			attribute.String("schema", s.Name),
			attribute.String("outcome", outcome),
		),
	)
	migrateDuration.Record(ctx, elapsed,
		metric.WithAttributes(
			attribute.String("schema", s.Name),
			attribute.String("outcome", outcome),
		),
	)
	return err
}
