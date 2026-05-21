// iedora — top-level infra orchestrator. Subcommands:
//
//	iedora deploy    — provision + apply the full estate (replaces the
//	                   `just infra::deploy` bash body).
//	iedora destroy   — tear down everything (replaces `just infra::destroy`).
//
// Design goals (per docs/deploy-fluency-brief.md):
//   - One Go binary, easy to type-check + unit-test, easy to extend.
//   - Idempotent: `iedora destroy && iedora deploy` from any prior state
//     lands a green stack with zero manual steps, on operator macOS + CI.
//   - Sidesteps the macOS NXDOMAIN cache trap for the Zitadel TF provider
//     via a localhost HTTP CONNECT proxy that pins auth.iedora.com to the
//     fresh Hetzner IPv4 (see proxy.go).
//   - Verifies the served TLS cert is real Let's Encrypt (not Caddy's
//     internal CA) before declaring Zitadel ready (see probe.go).
//
// The justfile recipes are 1-line shims into here — no business logic
// stays in bash. `bin/iedora` is the BWS-wrapped entrypoint used by
// every recipe and by CI.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	var err error
	switch os.Args[1] {
	case "deploy":
		err = runDeploy(ctx, os.Args[2:])
	case "destroy":
		err = runDestroy(ctx, os.Args[2:])
	case "doctor":
		err = runDoctor(ctx, os.Args[2:])
	case "-h", "--help", "help":
		usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "iedora: unknown subcommand %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "iedora %s: %v\n", os.Args[1], err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `Usage: iedora <subcommand> [flags]

Subcommands:
  deploy   Apply the full estate (Hetzner + Cloudflare + GH config + containers).
  destroy  Tear down every Tofu-managed resource and scrub instance-bound BWS keys.
  doctor   Diagnose deploy-readiness on the operator's machine.

The wrapping bin/iedora script injects BWS secrets as TF_VAR_* env vars
before exec'ing this binary, exactly like bin/with-secrets does for tofu.`)
}
