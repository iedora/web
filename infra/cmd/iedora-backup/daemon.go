package main

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"time"
)

// runDaemon is the container's default mode: sleep, backup, repeat.
// Sleeps first so a freshly-booted container doesn't immediately
// dump — gives postgres time to settle on a cold start.
//
// On backup failure the daemon logs + continues to the next cycle.
// The bash equivalent crashed the container on failure (set -e); the
// Go version is more forgiving — a transient pg/network blip
// shouldn't restart the container, just retry next interval.
func runDaemon(ctx context.Context) error {
	interval, err := parseSchedule(envOr("SCHEDULE", "@daily"))
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "[run] schedule=%s (interval=%s)\n", envOr("SCHEDULE", "@daily"), interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Fprintln(os.Stderr, "[run] shutdown")
			return nil
		case <-ticker.C:
			if err := runBackup(ctx); err != nil {
				fmt.Fprintf(os.Stderr, "[run] backup failed; will retry next cycle: %v\n", err)
			}
		}
	}
}

// parseSchedule accepts the same shapes the bash run.sh did:
// @daily/@hourly/@weekly cron-style aliases, or a positive integer
// number of seconds.
func parseSchedule(s string) (time.Duration, error) {
	switch s {
	case "@daily":
		return 24 * time.Hour, nil
	case "@hourly":
		return time.Hour, nil
	case "@weekly":
		return 7 * 24 * time.Hour, nil
	}
	if regexp.MustCompile(`^[0-9]+$`).MatchString(s) {
		n, err := strconv.Atoi(s)
		if err == nil && n > 0 {
			return time.Duration(n) * time.Second, nil
		}
	}
	return 0, fmt.Errorf("SCHEDULE=%q: want @daily/@hourly/@weekly or a positive integer seconds", s)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("missing required env %s", key)
	}
	return v, nil
}
