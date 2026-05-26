// bws-sync — batched BWS write/delete in a single process invocation.
//
// Walks the secret list sequentially in one pass: the BWS cloud-side
// rate-limits mutations at ~1/s globally per token, so any parallelism
// trips 429s and leaves destroys partially complete. One Tofu local-
// exec resource, one process, one pass.
//
// Modes:
//
//	BWS_DELETE unset (default) — upsert every key=value pair in
//	                             BWS_SECRETS_JSON (one secret per
//	                             top-level entry).
//	BWS_DELETE=1               — delete every key in BWS_KEYS
//	                             (comma-separated). Values not needed.
//
// Both modes are idempotent and tolerate "already gone" deletes (no-op).
// Failures abort the whole pass — Tofu sees exit 1 and re-runs on the
// next apply / destroy.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/eduvhc/iedora/internal/bws"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "bws-sync: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	projectID := os.Getenv("BWS_PROJECT_ID")
	if projectID == "" {
		return fmt.Errorf("BWS_PROJECT_ID missing")
	}

	ctx := context.Background()

	if os.Getenv("BWS_DELETE") == "1" {
		raw := os.Getenv("BWS_KEYS")
		if raw == "" {
			return fmt.Errorf("BWS_KEYS missing (comma-separated keys to delete)")
		}
		for _, key := range strings.Split(raw, ",") {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			fmt.Fprintf(os.Stderr, "→ delete %s\n", key)
			if err := bws.Delete(ctx, projectID, key); err != nil {
				return fmt.Errorf("delete %s: %w", key, err)
			}
		}
		return nil
	}

	raw := os.Getenv("BWS_SECRETS_JSON")
	if raw == "" {
		return fmt.Errorf("BWS_SECRETS_JSON missing (set BWS_DELETE=1 for delete mode)")
	}
	var data map[string]string
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return fmt.Errorf("decode BWS_SECRETS_JSON: %w", err)
	}
	// Sort keys so the apply log is deterministic — useful when chasing
	// flakes ("which one was Tofu writing when 429 hit?").
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sortStrings(keys)
	for _, key := range keys {
		fmt.Fprintf(os.Stderr, "→ upsert %s\n", key)
		if err := bws.Upsert(ctx, projectID, key, data[key]); err != nil {
			return fmt.Errorf("upsert %s: %w", key, err)
		}
	}
	return nil
}

// sortStrings is sort.Strings inlined to avoid the import for a 4-line use.
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
