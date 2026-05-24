// bws-upsert — write-or-update a single BWS secret by key.
//
// Tiny shim invoked from terraform_data.bws_sync_autogen's local-exec
// provisioner in infra/tofu/secrets.tf. Replaces the previous inline
// bash heredoc, which:
//
//   - Duplicated the logic in internal/bws.Upsert (had to be patched
//     twice when the bws CLI's clap parser started rejecting flag-like
//     values).
//   - Required `bash` + `jq` + the right escaping rules on every
//     execution host. The Go helper requires only `bws` itself, the
//     same hard dep the rest of the deploy already has.
//
// Inputs (env, matches the local-exec environment block):
//
//	BWS_PROJECT_ID  iedora-deploy project UUID
//	BWS_KEY         secret key (e.g. IAC_POSTGRES_PASSWORD)
//	BWS_VALUE       secret value (verbatim — may contain leading `-`,
//	                newlines, etc; the Go wrapper handles quoting)
//
// Exit 0 on success (create or edit), non-zero on any failure with a
// stderr diagnostic. Idempotent — bws.Upsert checks list-first, then
// either edits an existing secret or creates a new one.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "bws-upsert: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	projectID := os.Getenv("BWS_PROJECT_ID")
	if projectID == "" {
		return fmt.Errorf("BWS_PROJECT_ID missing")
	}
	key := os.Getenv("BWS_KEY")
	if key == "" {
		return fmt.Errorf("BWS_KEY missing")
	}
	// BWS_VALUE is allowed to be empty (representing "no value yet"),
	// so don't reject "". Reject only the unset case via os.LookupEnv.
	value, present := os.LookupEnv("BWS_VALUE")
	if !present {
		return fmt.Errorf("BWS_VALUE not set in environment")
	}

	return bws.Upsert(context.Background(), projectID, key, value)
}
