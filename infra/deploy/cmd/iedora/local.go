package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// `iedora local env` writes apps/web/.env from the topology +
// runtime_local.go infra-static map. Called from bin/dev-stack
// step 3. Non-destructive — does NOT shell out, does NOT touch the
// live runtime, so the Live-mode guard in main.go doesn't apply.

func runLocal(ctx context.Context, argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("local requires a subcommand: env | migrate")
	}
	switch argv[0] {
	case "env":
		return runLocalEnv(argv[1:])
	case "migrate":
		return runLocalMigrate(ctx, argv[1:])
	default:
		return fmt.Errorf("local: unknown subcommand %q (want env | migrate)", argv[0])
	}
}

func runLocalEnv(argv []string) error {
	fs := flag.NewFlagSet("local env", flag.ContinueOnError)
	envPath := fs.String("out", "", "path to write the .env file (required)")
	envLocalPath := fs.String("local", "", "path to .env.local for CORE_SECRET carry-over (required)")
	composeEnvPath := fs.String("compose-env", "", "path to dev/.env that holds S3MOCK_HTTP_PORT (optional)")
	if err := fs.Parse(argv); err != nil {
		return err
	}
	if *envPath == "" || *envLocalPath == "" {
		fs.Usage()
		return fmt.Errorf("--out and --local are required")
	}

	s3Port := 9090
	if *composeEnvPath != "" {
		if p, err := readS3Port(*composeEnvPath); err == nil && p > 0 {
			s3Port = p
		}
	}

	abs, err := filepath.Abs(*envPath)
	if err != nil {
		return err
	}
	absLocal, err := filepath.Abs(*envLocalPath)
	if err != nil {
		return err
	}

	if err := writeDevEnv(abs, absLocal, s3Port); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "iedora local env: wrote %s\n", abs)
	return nil
}

func readS3Port(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		const k = "S3MOCK_HTTP_PORT="
		if len(line) > len(k) && line[:len(k)] == k {
			return strconv.Atoi(line[len(k):])
		}
	}
	return 0, sc.Err()
}
